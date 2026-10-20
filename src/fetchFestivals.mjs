// Finds festival/holiday skins, minis and novelties (Lunar New Year, Super
// Adventure Festival, Dragon Bash, Festival of the Four Winds, Halloween,
// Wintersday) and how each is obtained. Writes data/festivals.json.
//
// Sources, per festival:
//  1. The festival's category tree on the GW2 Wiki (BFS, depth <= 3).
//  2. The festival's "<Festival>/items" index page: every skin/mini/novelty
//     linked from its weapon, armor, mini and tonic sections, and the full
//     weapon sets (pages like "Candy Core weapons") listed there.
//  3. The festival's vendor pages, whose item tables give cost and weekly
//     limits - both for individual items and for chests holding a whole set.
// Titles are matched by name to the official API's skins / minis / novelties
// (novelties also by their unlock item's name).
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getCategoryMembers, parsePageHtml } from "./wikiApi.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(__dirname, "..", "data");
const API = "https://api.guildwars2.com/v2";

// In calendar order. `page` is the wiki article/category stem.
const FESTIVALS = [
  { key: "lunar-new-year", label: "Lunar New Year", emoji: "🧧", page: "Lunar New Year" },
  {
    key: "super-adventure-festival",
    label: "Super Adventure Festival",
    emoji: "🕹️",
    page: "Super Adventure Box",
    seeds: ["Category:Super Adventure Box", "Category:Super Adventure Box miniatures", "Category:Super Adventure Box weapons"],
  },
  { key: "dragon-bash", label: "Dragon Bash", emoji: "🐉", page: "Dragon Bash" },
  {
    key: "four-winds",
    label: "Festival of the Four Winds",
    emoji: "🪁",
    page: "Festival of the Four Winds",
    seeds: ["Category:Bazaar of the Four Winds", "Category:Queen's Jubilee"],
  },
  {
    key: "halloween",
    label: "Halloween",
    emoji: "🎃",
    page: "Halloween",
    seeds: [
      "Category:Shadow of the Mad King",
      "Category:Blood and Madness",
      "Category:Lunatic armor",
      "Category:Halloween armor",
      "Category:Halloween weapons",
    ],
    // Item pages in this category carry per-weapon acquisition (mystic forge,
    // Trick-or-Treat bags, ...) not visible from vendor tables.
    weaponCategory: "Category:Halloween weapons",
  },
  { key: "wintersday", label: "Wintersday", emoji: "❄️", page: "Wintersday" },
];

const MAX_DEPTH = 3;
// Subcategories that only hold NPCs, maps, events, screenshots, etc.
const SKIP_SUBCAT = /screenshot|events$|creatures|recipes|area maps|decorations/i;
// Item-page sections whose links are candidate skins / minis / novelties.
const WANTED_SECTION = /Weapon|Armor|Infusion|Mini|Tonic|novelt|Items$|Consumables|Miscellaneous/i;
const CURRENCY = /^(Gold|Silver|Copper) coin$|^Karma$|^Laurel$|^Gem$|Coin$/;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function normalizeTitle(title) {
  return title
    .replace(/ \((?:light|medium|heavy)(?: skin)?\)$/, "")
    .replace(/ \((?:weapon|masterwork|skin)\)$/, "")
    .replace(/ Skin$/, "");
}

const decodeHtml = (s) => s.replace(/&#39;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, '"');
const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const strip = (s) =>
  decodeHtml(
    s
      .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&#160;|&nbsp;|&#8201;/g, " ")
  )
    .replace(/\s+/g, " ")
    .trim();

// Cost cells hold currency icons as <img alt="Candy Corn Cob">; keep the alt text.
const costText = (cell) => strip(cell.replace(/<img[^>]*alt="([^"]*)"[^>]*>/g, " $1 ")).replace(/\s+\+\s+/g, " + ");

const anchorTitles = (html) => [...new Set([...html.matchAll(/<a href="\/wiki\/[^"#]+" title="([^"]+)"/g)].map((m) => decodeHtml(m[1])))];

function sectionHtml(html, id) {
  const start = html.indexOf(`id="${id}"`);
  if (start < 0) return "";
  const rest = html.slice(start + 20);
  const end = rest.search(/<h2/);
  return html.slice(start, end > 0 ? start + 20 + end : undefined);
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

function addTitle(titles, rawTitle, label) {
  const key = normalizeTitle(rawTitle);
  if (!titles.has(key)) titles.set(key, new Set());
  titles.get(key).add(label);
}

// 1. BFS the festival's category tree.
async function crawlCategories(seeds, titles) {
  const visited = new Set();
  let frontier = seeds.map((c) => ({ cat: c, depth: 0 }));
  while (frontier.length) {
    const next = [];
    for (const { cat, depth } of frontier) {
      if (visited.has(cat)) continue;
      visited.add(cat);
      const members = await getCategoryMembers(cat, { cmtype: "page|subcat" });
      await sleep(40);
      const catName = cat.replace(/^Category:/, "");
      for (const m of members) {
        if (m.ns === 14) {
          if (depth < MAX_DEPTH && !SKIP_SUBCAT.test(m.title)) next.push({ cat: m.title, depth: depth + 1 });
        } else if (m.ns === 0) {
          addTitle(titles, m.title, catName);
        }
      }
    }
    frontier = next;
  }
  return visited.size;
}

// 2. The "<Festival>/items" index: candidate item titles and weapon-set pages.
async function crawlItemsPage(page, titles) {
  const html = await parsePageHtml(`${page}/items`);
  if (!html) return { setTitles: [], added: 0 };
  const before = titles.size;
  const setTitles = new Set();
  for (const part of html.split(/<h2/).slice(1)) {
    const id = part.match(/id="([^"]+)"/)?.[1] ?? "";
    if (!WANTED_SECTION.test(id) || /^Edit/.test(id)) continue;
    for (const t of anchorTitles(part)) {
      if (/^(API:|Category:|Decoration|Edit section)/.test(t) || CURRENCY.test(t)) continue;
      if (/ weapons$/.test(t) && /Weapon/i.test(id)) setTitles.add(t);
      else addTitle(titles, t, `${page}/items`);
    }
  }
  return { setTitles: [...setTitles], added: titles.size - before };
}

// 3a. Vendors named in the festival page's "Vendors" section -> item sales.
function parseSalesTables(html, vendor, sales) {
  for (const table of html.split(/<table/).slice(1)) {
    const rows = table.match(/<tr[\s\S]*?<\/tr>/g) ?? [];
    if (!rows.length) continue;
    const headers = [...rows[0].matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map((m) => strip(m[1]));
    const costIdx = headers.findIndex((h) => /^Cost/i.test(h));
    if (costIdx < 0) continue;
    for (const row of rows.slice(1)) {
      const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1]);
      if (cells.length <= costIdx) continue;
      const raw = strip(cells[0]);
      const limit = raw.match(/\(([^)]*per (?:week|day|account)[^)]*)\)/i)?.[1] ?? null;
      const item = raw.replace(/\s*\([^)]*\)\s*/g, " ").trim();
      const cost = costText(cells[costIdx]);
      if (!item || !cost || cost === "…") continue;
      if (!sales.has(item)) sales.set(item, { vendor, cost, limit });
    }
  }
}

async function crawlVendorSales(page) {
  const main = (await parsePageHtml(page)) ?? "";
  const sec = main.indexOf('id="Vendors"');
  const vendors = new Set();
  if (sec >= 0) {
    const seg = main.slice(sec, sec + 8000);
    const end = seg.slice(20).search(/<h2/);
    for (const t of anchorTitles(end > 0 ? seg.slice(0, end + 20) : seg)) {
      if (!/Black Lion|^Edit|^Category:/.test(t)) vendors.add(t);
    }
  }
  const sales = new Map();
  for (const vendor of vendors) {
    const html = await parsePageHtml(vendor);
    await sleep(40);
    if (html) parseSalesTables(html, vendor, sales);
  }
  return { sales, vendorCount: vendors.size };
}

// 3b. Full weapon sets: members from Category:<set>, acquisition from the set
// page's anchors (chests, bags, vendors) cross-checked against vendor sales.
// Set members are often item pages with a stat prefix ("Giver's Candy Cane Axe")
// while the wardrobe skin has none ("Candy Cane Axe").
function resolveSkinName(name, skinNames) {
  if (skinNames.has(name)) return name;
  const bare = name.replace(/^[A-Z][A-Za-z]+'s /, "");
  return skinNames.has(bare) ? bare : name;
}

async function crawlWeaponSets(setTitles, sales, festival, skinNames) {
  const byName = new Map();
  for (const setTitle of setTitles) {
    const members = (await getCategoryMembers(`Category:${setTitle}`, { cmtype: "page" }))
      .map((m) => normalizeTitle(m.title))
      .filter((n) => n !== setTitle);
    await sleep(40);
    if (!members.length) continue;

    const setHtml = (await parsePageHtml(setTitle)) ?? "";
    await sleep(40);
    const released = strip(setHtml.slice(0, 4000)).match(/Release\s+([A-Z][a-z]+ \d{1,2}, \d{4})/)?.[1] ?? null;
    const acqSeg = sectionHtml(setHtml, "Acquisition");
    const acqText = strip(acqSeg);
    const anchors = anchorTitles(acqSeg).filter((t) => !/ weapons$/.test(t) && !CURRENCY.test(t) && !/^(Candy Corn Cob|Snow Diamond|Festival Token)$/.test(t));

    const acq = new Set();
    let vendor = null;
    for (const anchor of anchors) {
      const discontinued = new RegExp(`${escapeRegExp(anchor)}\\s*\\([^)]*discontinued`, "i").test(acqText);
      const sale = sales.get(anchor);
      if (sale && !discontinued) {
        acq.add("vendor");
        vendor ??= { name: sale.vendor, cost: sale.cost, item: anchor, limit: sale.limit, festival: festival.label };
        continue;
      }
      if (/Prize Bag|Prize Coffer/.test(anchor)) acq.add("prize-bag");
      if (/Trick-or-Treat Bag/.test(anchor)) acq.add("trick-or-treat");
      if (!sale && !/Bag/.test(anchor)) {
        const ph = (await parsePageHtml(anchor)) ?? "";
        await sleep(40);
        const chestText = strip(sectionHtml(ph, "Acquisition").slice(0, 5000));
        if (/achievement/i.test(chestText)) acq.add(discontinued ? "achievement-past" : "achievement");
        if (/Trick-or-Treat Bag/.test(chestText)) acq.add("trick-or-treat");
      }
    }

    for (const name of members) byName.set(resolveSkinName(name, skinNames), { acq: new Set(acq), vendor, set: setTitle, released });
    console.log(`    set ${setTitle} (${released ?? "?"}): ${members.length} weapons, ${[...acq].join("+") || "per-item"}`);
  }
  return byName;
}

// Halloween-only: per-weapon acquisition from each weapon item's own page.
function classifyAcquisition(html, festival) {
  const seg = sectionHtml(html, "Acquisition");
  if (!seg) return null;
  const text = strip(seg);
  const acq = new Set();
  let vendor = null;
  const soldAt = seg.indexOf('id="Sold_by"');
  if (soldAt >= 0) {
    for (const row of seg.slice(soldAt).match(/<tr>[\s\S]*?<\/tr>/g) ?? []) {
      const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1]);
      if (cells.length < 5 || !new RegExp(`festival\\s+${escapeRegExp(festival.label)}`, "i").test(strip(cells[4]))) continue;
      acq.add("vendor");
      vendor = { name: strip(cells[0]), area: strip(cells[1]), zone: strip(cells[2]), cost: costText(cells[3]), festival: festival.label };
    }
  }
  if (/Trick-or-Treat Bag/.test(text)) acq.add("trick-or-treat");
  if (/Courtly Weapon Chest/.test(text)) acq.add("chest");
  if (/Source\s+Mystic Forge/.test(text)) acq.add("mystic-forge");
  if (/Festival Collections/.test(text)) acq.add("collection");
  if (/Drops from any Halloween creature/.test(text)) acq.add("drop");
  return { acq, vendor };
}

async function crawlWeaponCategory(category, festival) {
  const byName = new Map();
  const pages = await getCategoryMembers(category, { cmtype: "page" });
  for (const p of pages) {
    if (p.title === category.replace(/^Category:/, "")) continue;
    const html = await parsePageHtml(p.title);
    await sleep(40);
    const info = html && classifyAcquisition(html, festival);
    if (!info) continue;
    const key = normalizeTitle(p.title);
    const cur = byName.get(key) ?? { acq: new Set(), vendor: null };
    info.acq.forEach((k) => cur.acq.add(k));
    cur.vendor ??= info.vendor;
    byName.set(key, cur);
  }
  return byName;
}

async function main() {
  const skins = JSON.parse(await readFile(path.join(DATA, "skins.json"), "utf8"));
  const skinNames = new Set(skins.map((s) => s.name));

  console.log("Fetching minis and novelties from the API...");
  const minis = await fetchAll("minis", await fetchJson(`${API}/minis`));
  const novelties = await fetchAll("novelties", await fetchJson(`${API}/novelties`));
  const unlockItemIds = [...new Set(novelties.flatMap((n) => n.unlock_item ?? []))];
  const itemNames = new Map((await fetchAll("items", unlockItemIds)).map((i) => [i.id, i.name]));

  const byName = (a, b) => a.name.localeCompare(b.name);
  const outFestivals = [];

  for (const f of FESTIVALS) {
    console.log(`\n== ${f.label} ==`);
    const titles = new Map();
    const seeds = f.seeds ?? [];
    const allSeeds = [`Category:${f.page}`, `Category:Gem Store ${f.page} items`, `Category:${f.page} miniatures`, ...seeds];
    const cats = await crawlCategories(allSeeds, titles);
    const { setTitles, added } = await crawlItemsPage(f.page, titles);
    console.log(`  ${cats} categories, +${added} titles from ${f.page}/items, ${setTitles.length} weapon sets`);

    const { sales, vendorCount } = await crawlVendorSales(f.page);
    console.log(`  ${sales.size} vendor sale rows from ${vendorCount} vendor pages`);

    const setAcq = await crawlWeaponSets(setTitles, sales, f, skinNames);
    for (const [name, info] of setAcq) addTitle(titles, name, info.set);
    const weaponAcq = f.weaponCategory ? await crawlWeaponCategory(f.weaponCategory, f) : new Map();

    const labelFor = (name) => [...(titles.get(name) ?? [])].slice(0, 4);
    const saleFor = (name) => {
      const s = sales.get(name);
      return s ? { acq: ["vendor"], vendor: { name: s.vendor, cost: s.cost, item: null, limit: s.limit, festival: f.label } } : null;
    };

    const fSkins = skins
      .filter((s) => titles.has(s.name))
      .map((s) => {
        const set = s.type === "Weapon" ? setAcq.get(s.name) : null;
        const base = s.type === "Weapon" ? weaponAcq.get(s.name) : null;
        const sold = saleFor(s.name);
        const acq = new Set([...(base?.acq ?? []), ...(set?.acq ?? []), ...(sold?.acq ?? [])]);
        const vendor = set?.vendor ?? base?.vendor ?? sold?.vendor ?? null;
        return {
          ...(set ? { set: set.set, released: set.released } : {}),
          id: s.id,
          name: s.name,
          type: s.type,
          rarity: s.rarity,
          weight_class: s.details?.weight_class ?? null,
          icon: s.icon ?? null,
          cats: labelFor(s.name),
          ...(acq.size ? { acq: [...acq], vendor } : {}),
        };
      })
      .sort(byName);

    const fMinis = minis
      .filter((m) => titles.has(m.name))
      .map((m) => {
        const sold = saleFor(m.name);
        return { id: m.id, name: m.name, icon: m.icon ?? null, item_id: m.item_id ?? null, cats: labelFor(m.name), ...(sold ? { acq: sold.acq, vendor: sold.vendor } : {}) };
      })
      .sort(byName);

    const fNovelties = [];
    for (const n of novelties) {
      const candidates = [n.name, ...(n.unlock_item ?? []).map((id) => itemNames.get(id)).filter(Boolean)];
      const hit = candidates.find((c) => titles.has(c));
      if (!hit) continue;
      const sold = candidates.map(saleFor).find(Boolean);
      fNovelties.push({ id: n.id, name: n.name, slot: n.slot ?? null, icon: n.icon ?? null, cats: labelFor(hit), ...(sold ? { acq: sold.acq, vendor: sold.vendor } : {}) });
    }
    fNovelties.sort(byName);

    const missing = [...setAcq.keys()].filter((n) => !skinNames.has(n));
    if (missing.length) console.log(`  set weapons with no API skin: ${missing.join(", ")}`);
    const vendorCount2 = [...fSkins, ...fMinis, ...fNovelties].filter((i) => i.acq?.includes("vendor")).length;
    console.log(`  => ${fSkins.length} skins, ${fMinis.length} minis, ${fNovelties.length} novelties (${vendorCount2} sold by a festival vendor)`);

    outFestivals.push({ key: f.key, label: f.label, emoji: f.emoji, page: f.page, skins: fSkins, minis: fMinis, novelties: fNovelties });
  }

  await writeFile(
    path.join(DATA, "festivals.json"),
    JSON.stringify({ generatedAt: new Date().toISOString(), festivals: outFestivals }, null, 2)
  );
  console.log(`\nWrote ${path.join(DATA, "festivals.json")}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
