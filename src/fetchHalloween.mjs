// Finds Halloween-event skins, minis and novelties by crawling the GW2 Wiki's
// Halloween categories (Shadow of the Mad King, Blood and Madness, ...) and
// matching article titles against the official API's skin / mini / novelty
// names. Writes data/halloween.json.
//
// Matching is by name: wiki titles are normalized by dropping the " Skin"
// consumable-item suffix and the "(light|medium|heavy skin)" weight-class
// disambiguation (see skinTitle.mjs). Novelties are also matched by the name
// of the item that unlocks them, since the two names often differ.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getCategoryMembers, parsePageHtml } from "./wikiApi.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(__dirname, "..", "data");
const API = "https://api.guildwars2.com/v2";

const SEEDS = [
  "Category:Halloween",
  "Category:Gem Store Halloween items",
  "Category:Shadow of the Mad King",
  "Category:Blood and Madness",
  "Category:Lunatic armor",
  "Category:Halloween armor",
  "Category:Halloween weapons",
];
const MAX_DEPTH = 3;
// Subcategories that only hold NPCs, maps, events, screenshots, etc.
const SKIP_SUBCAT = /screenshot|events$|creatures|recipes|area maps/i;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function normalizeTitle(title) {
  return title
    .replace(/ \((light|medium|heavy) skin\)$/, "")
    .replace(/ \((weapon|masterwork)\)$/, "")
    .replace(/ Skin$/, "");
}

const strip = (s) =>
  s
    .replace(/<[^>]+>/g, " ")
    .replace(/&#160;|&nbsp;|&#8201;/g, " ")
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

// Cost cells hold currency icons as <img alt="Candy Corn Cob">; keep the alt text.
const costText = (cell) => strip(cell.replace(/<img[^>]*alt="([^"]*)"[^>]*>/g, " $1 ")).replace(/\s+\+\s+/g, " + ");

// How a Halloween weapon is obtained, read from its wiki "Acquisition" section.
// Keys: vendor (festival vendor, Halloween only), trick-or-treat, chest
// (Courtly Weapon Chest), mystic-forge, collection (Mad Armory), drop.
function classifyAcquisition(html) {
  const a = html.indexOf('id="Acquisition"');
  if (a < 0) return null;
  let seg = html.slice(a);
  const end = seg.search(/<h2/);
  if (end > 0) seg = seg.slice(0, end);
  const text = strip(seg);

  const acq = new Set();
  let vendor = null;

  const soldAt = seg.indexOf('id="Sold_by"');
  if (soldAt >= 0) {
    let sold = seg.slice(soldAt);
    const next = sold.slice(20).search(/<h3/);
    if (next > 0) sold = sold.slice(0, next + 20);
    for (const row of sold.match(/<tr>[\s\S]*?<\/tr>/g) ?? []) {
      const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1]);
      if (cells.length < 5 || !/festival\s+Halloween/i.test(strip(cells[4]))) continue;
      acq.add("vendor");
      vendor = { name: strip(cells[0]), area: strip(cells[1]), zone: strip(cells[2]), cost: costText(cells[3]) };
    }
  }
  if (/Trick-or-Treat Bag/.test(text)) acq.add("trick-or-treat");
  if (/Courtly Weapon Chest/.test(text)) acq.add("chest");
  if (/Source\s+Mystic Forge/.test(text)) acq.add("mystic-forge");
  if (/Festival Collections/.test(text)) acq.add("collection");
  if (/Drops from any Halloween creature/.test(text)) acq.add("drop");
  return { acq, vendor };
}

const decodeHtml = (s) => s.replace(/&#39;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, '"');
const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Vendors whose item tables list Halloween weapons (or the chests holding
// whole weapon sets). Sparking Stone's table also covers other festivals, but
// we only ever look items up by Halloween weapon name so that's harmless.
const VENDOR_PAGES = [
  "Lunatic Weaponsmith Markham",
  "Candy Corn Vendor",
  "Candy Corn Vendor (Weekly)",
  "Mysterious Craftsraven",
  "Sparking Stone",
];

// item name -> { vendor, cost, limit } from each vendor page's item tables.
async function crawlVendorSales() {
  const sales = new Map();
  for (const page of VENDOR_PAGES) {
    const html = await parsePageHtml(page);
    await sleep(50);
    if (!html) continue;
    for (const row of html.match(/<tr[\s\S]*?<\/tr>/g) ?? []) {
      const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1]);
      if (cells.length < 4) continue;
      const raw = strip(cells[0]);
      const limit = raw.match(/\(([^)]*per week[^)]*)\)/i)?.[1] ?? null;
      const item = raw.replace(/\s*\([^)]*\)\s*/g, " ").trim();
      const cost = costText(cells[3]);
      if (!item || !cost) continue;
      if (!sales.has(item)) sales.set(item, { vendor: page, cost, limit });
    }
  }
  console.log(`Read ${sales.size} vendor sale rows from ${VENDOR_PAGES.length} vendor pages.`);
  return sales;
}

// Full weapon sets (Chained, Grim Machine, Candy Core, Unchained, Haunted,
// Demon-Haunted, Royal Flame, ...) listed on the wiki's Halloween/items page.
// Those pages aren't in Category:Halloween, so they need their own crawl.
async function crawlWeaponSets(sales) {
  const html = await parsePageHtml("Halloween/items");
  const start = html.indexOf('id="Weapon_skins_and_weapons"');
  let seg = html.slice(start + 20);
  const end = seg.search(/<h2/);
  if (end > 0) seg = seg.slice(0, end);
  const setTitles = [...new Set([...seg.matchAll(/title="([^"]+ weapons)"/g)].map((m) => decodeHtml(m[1])))].filter(
    (t) => !t.startsWith("Edit section")
  );
  console.log(`Weapon sets on Halloween/items: ${setTitles.join(", ")}`);

  const byName = new Map();
  for (const setTitle of setTitles) {
    const members = (await getCategoryMembers(`Category:${setTitle}`, { cmtype: "page" }))
      .map((m) => normalizeTitle(m.title))
      .filter((n) => n !== setTitle);
    await sleep(50);

    const setHtml = (await parsePageHtml(setTitle)) ?? "";
    await sleep(50);
    const released = strip(setHtml.slice(0, 4000)).match(/Release\s+([A-Z][a-z]+ \d{1,2}, \d{4})/)?.[1] ?? null;

    const a = setHtml.indexOf('id="Acquisition"');
    let acqSeg = a >= 0 ? setHtml.slice(a) : "";
    const e = acqSeg.slice(20).search(/<h2/);
    if (e > 0) acqSeg = acqSeg.slice(0, e + 20);
    const acqText = strip(acqSeg);
    const anchors = [...new Set([...acqSeg.matchAll(/<a href="\/wiki\/[^"]+" title="([^"]+)"/g)].map((m) => decodeHtml(m[1])))].filter(
      (t) => !/ weapons$/.test(t) && !/^(Gold coin|Candy Corn Cob)$/.test(t)
    );

    const acq = new Set();
    let vendor = null;
    for (const anchor of anchors) {
      const discontinued = new RegExp(`${escapeRegExp(anchor)}\\s*\\([^)]*discontinued`, "i").test(acqText);
      const sale = sales.get(anchor);
      if (sale && !discontinued) {
        acq.add("vendor");
        vendor ??= { name: sale.vendor, area: "", zone: "", cost: sale.cost, item: anchor, limit: sale.limit };
        continue;
      }
      if (/Prize Bag/.test(anchor)) acq.add("prize-bag");
      if (/Trick-or-Treat Bag/.test(anchor)) acq.add("trick-or-treat");
      if (!sale && !/Bag/.test(anchor)) {
        const ph = (await parsePageHtml(anchor)) ?? "";
        await sleep(50);
        const pa = ph.indexOf('id="Acquisition"');
        const chestText = pa >= 0 ? strip(ph.slice(pa, pa + 4000)) : "";
        if (/achievement/i.test(chestText)) acq.add(discontinued ? "achievement-past" : "achievement");
        if (/Trick-or-Treat Bag/.test(chestText)) acq.add("trick-or-treat");
      }
    }

    for (const name of members) {
      const direct = sales.get(name);
      const own = new Set(acq);
      let v = vendor;
      if (direct) {
        own.add("vendor");
        v = { name: direct.vendor, area: "", zone: "", cost: direct.cost, item: null, limit: direct.limit };
      }
      byName.set(name, { acq: own, vendor: v, set: setTitle, released });
    }
    console.log(`  ${setTitle} (${released ?? "?"}): ${members.length} weapons, acquisition ${[...acq].join("+") || "(per-weapon vendor)"}`);
  }
  return byName;
}

async function crawlWeaponAcquisition() {
  const pages = await getCategoryMembers("Category:Halloween weapons", { cmtype: "page" });
  const byName = new Map();
  for (const p of pages) {
    if (p.title === "Halloween weapons") continue;
    const html = await parsePageHtml(p.title);
    await sleep(50);
    const info = html && classifyAcquisition(html);
    if (!info) continue;
    const key = normalizeTitle(p.title);
    const cur = byName.get(key) ?? { acq: new Set(), vendor: null };
    info.acq.forEach((k) => cur.acq.add(k));
    cur.vendor ??= info.vendor;
    byName.set(key, cur);
  }
  console.log(`Classified acquisition for ${byName.size} Halloween weapons.`);
  return byName;
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

async function fetchAll(endpoint, ids) {
  const out = [];
  for (let i = 0; i < ids.length; i += 200) {
    out.push(...(await fetchJson(`${API}/${endpoint}?ids=${ids.slice(i, i + 200).join(",")}&lang=en`)));
  }
  return out;
}

// BFS the category tree; returns Map<normalizedTitle, Set<categoryName>>.
async function crawlHalloween() {
  const titles = new Map();
  const visited = new Set();
  let frontier = SEEDS.map((c) => ({ cat: c, depth: 0 }));

  while (frontier.length) {
    const next = [];
    for (const { cat, depth } of frontier) {
      if (visited.has(cat)) continue;
      visited.add(cat);
      const members = await getCategoryMembers(cat, { cmtype: "page|subcat" });
      await sleep(50);
      const catName = cat.replace(/^Category:/, "");
      for (const m of members) {
        if (m.ns === 14) {
          if (depth < MAX_DEPTH && !SKIP_SUBCAT.test(m.title)) next.push({ cat: m.title, depth: depth + 1 });
        } else if (m.ns === 0) {
          const key = normalizeTitle(m.title);
          if (!titles.has(key)) titles.set(key, new Set());
          titles.get(key).add(catName);
        }
      }
    }
    frontier = next;
  }
  console.log(`Crawled ${visited.size} categories, ${titles.size} distinct Halloween article titles.`);
  return titles;
}

async function main() {
  const titles = await crawlHalloween();
  const cats = (name) => [...(titles.get(name) ?? [])].slice(0, 4);

  const weaponAcq = await crawlWeaponAcquisition();
  const sales = await crawlVendorSales();
  const setAcq = await crawlWeaponSets(sales);
  for (const [name, info] of setAcq) {
    if (!titles.has(name)) titles.set(name, new Set());
    titles.get(name).add(info.set);
  }

  const skins = JSON.parse(await readFile(path.join(DATA, "skins.json"), "utf8"));
  const skinNames = new Set(skins.map((s) => s.name));
  const unmatched = [...setAcq.keys()].filter((n) => !skinNames.has(n));
  if (unmatched.length) console.log(`Set weapons with no API skin of that name: ${unmatched.join(", ")}`);

  const haloSkins = skins
    .filter((s) => titles.has(s.name))
    .map((s) => {
      const base = s.type === "Weapon" ? weaponAcq.get(s.name) : null;
      const set = s.type === "Weapon" ? setAcq.get(s.name) : null;
      const info =
        base || set
          ? { acq: new Set([...(base?.acq ?? []), ...(set?.acq ?? [])]), vendor: set?.vendor ?? base?.vendor ?? null }
          : null;
      return {
        ...(set ? { set: set.set, released: set.released } : {}),
        id: s.id,
        name: s.name,
        type: s.type,
        rarity: s.rarity,
        weight_class: s.details?.weight_class ?? null,
        icon: s.icon ?? null,
        cats: cats(s.name),
        ...(info && info.acq.size ? { acq: [...info.acq], vendor: info.vendor } : {}),
      };
    });

  console.log("Fetching minis and novelties...");
  const miniIds = await fetchJson(`${API}/minis`);
  const minis = await fetchAll("minis", miniIds);
  const haloMinis = minis
    .filter((m) => titles.has(m.name))
    .map((m) => ({ id: m.id, name: m.name, icon: m.icon ?? null, item_id: m.item_id ?? null, cats: cats(m.name) }));

  const novIds = await fetchJson(`${API}/novelties`);
  const novelties = await fetchAll("novelties", novIds);
  const unlockItemIds = [...new Set(novelties.flatMap((n) => n.unlock_item ?? []))];
  const itemNames = new Map((await fetchAll("items", unlockItemIds)).map((i) => [i.id, i.name]));
  const haloNovelties = [];
  for (const n of novelties) {
    const candidates = [n.name, ...(n.unlock_item ?? []).map((id) => itemNames.get(id)).filter(Boolean)];
    const hit = candidates.find((c) => titles.has(c));
    if (!hit) continue;
    haloNovelties.push({ id: n.id, name: n.name, slot: n.slot ?? null, icon: n.icon ?? null, cats: cats(hit) });
  }

  const byName = (a, b) => a.name.localeCompare(b.name);
  haloSkins.sort(byName);
  haloMinis.sort(byName);
  haloNovelties.sort(byName);

  const out = {
    generatedAt: new Date().toISOString(),
    seeds: SEEDS,
    skins: haloSkins,
    minis: haloMinis,
    novelties: haloNovelties,
  };
  await writeFile(path.join(DATA, "halloween.json"), JSON.stringify(out, null, 2));
  console.log(`Halloween: ${haloSkins.length} skins, ${haloMinis.length} minis, ${haloNovelties.length} novelties.`);
  const vendorSkins = haloSkins.filter((s) => s.acq?.includes("vendor"));
  console.log(`Sold by a Halloween-only festival vendor: ${vendorSkins.map((s) => s.name).join(", ")}`);
  console.log(`Wrote ${path.join(DATA, "halloween.json")}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
