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
import { existingTitles, getCategoryMembers, parsePageHtml, searchTitles } from "./wikiApi.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(__dirname, "..", "data");
const API = "https://api.guildwars2.com/v2";

// In calendar order. `page` is the wiki article/category stem.
const FESTIVALS = [
  // `extraVendors`: merchants the wiki files under Category:Festival Merchants
  // (or the festival's own categories) that the festival page's "Vendors"
  // section doesn't link. Titles containing "(historical)" are treated as
  // vendors that no longer sell anything.
  { key: "lunar-new-year", label: "Lunar New Year", emoji: "🧧", page: "Lunar New Year", extraVendors: ["Fortune Scrap Vendor"] },
  {
    key: "super-adventure-box",
    label: "Super Adventure Box",
    emoji: "🕹️",
    page: "Super Adventure Box",
    seeds: ["Category:Super Adventure Box", "Category:Super Adventure Box miniatures", "Category:Super Adventure Box weapons"],
    extraVendors: ["Super Adventure Box Trader", "Super Adventure Box Weaponsmith", "Super Adventure Box Weekly Trader"],
  },
  { key: "dragon-bash", label: "Dragon Bash", emoji: "🐉", page: "Dragon Bash", extraVendors: ["Dragon Bash Vendor"] },
  {
    key: "four-winds",
    label: "Festival of the Four Winds",
    emoji: "🪁",
    page: "Festival of the Four Winds",
    seeds: ["Category:Bazaar of the Four Winds", "Category:Queen's Jubilee"],
    extraVendors: [
      "Four Winds Vendor",
      "Andile",
      "Haming",
      "Lonan",
      "Penna",
      "Zalman",
      "Bartender (Bazaar Docks)",
      "Ebonhawke Emissary (historical)",
      "Hoelbrak Emissary (historical)",
      "Rata Sum Emissary (historical)",
    ],
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
    extraVendors: ["Court Merchant", "Lunatic Chef"],
  },
  { key: "wintersday", label: "Wintersday", emoji: "❄️", page: "Wintersday", extraVendors: ["Charity Corps Seraph (historical)"] },
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
  return visited;
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

// 2b. Per-year festival pages ("Shadow of the Mad King 2026"). A new year's
// weapon set and items show up in its "New skins and equipment" /
// "New miniatures" / "New items" sections before the <Festival>/items index is
// updated, so this is how a brand-new set gets discovered.
const YEAR_STEMS = {
  "lunar-new-year": "Lunar New Year",
  "super-adventure-box": "Super Adventure Festival",
  "dragon-bash": "Dragon Bash",
  "four-winds": "Festival of the Four Winds",
  halloween: "Shadow of the Mad King",
  wintersday: "A Very Merry Wintersday",
};
const NEW_SECTION = /^New_(skins|equipment|miniatures|minis|items|weapons|armor|tonics|novelties|back)/i;

async function crawlYearPages(festival, titles) {
  const stem = YEAR_STEMS[festival.key];
  if (!stem) return { setTitles: [], pages: 0, added: 0 };
  const thisYear = new Date().getFullYear();
  const candidates = [];
  for (let y = 2012; y <= thisYear; y++) candidates.push(`${stem} ${y}`);
  const pages = [...(await existingTitles(candidates))];

  const before = titles.size;
  const setTitles = new Set();
  for (const page of pages) {
    const html = await parsePageHtml(page);
    await sleep(40);
    if (!html) continue;
    // "New ..." sections are usually <h3>s under a "<year> features" <h2>.
    for (const part of html.split(/<h[234]/).slice(1)) {
      const id = part.match(/id="([^"]+)"/)?.[1] ?? "";
      if (!NEW_SECTION.test(id)) continue;
      for (const t of anchorTitles(part.split(/<h[234]/)[0])) {
        if (/^(API:|Category:|Decoration|Edit section)/.test(t) || CURRENCY.test(t)) continue;
        // Only weapon sets listed under "New ..." count: the rest of a year page
        // also links unrelated sets (returning features, Wizard's Vault, ...).
        if (/ weapons$/.test(t)) setTitles.add(t);
        else addTitle(titles, t, page);
      }
    }
  }
  return { setTitles: [...setTitles], pages: pages.length, added: titles.size - before };
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
      // Prefer the row's first link (the item's real title) over its text, which
      // can carry notes like "(Requires ... or ...)".
      const linked = cells[0].match(/<a href="\/wiki\/[^"#]+" title="([^"]+)"/)?.[1];
      const item = normalizeTitle(linked ? decodeHtml(linked) : raw.replace(/\s*\([^)]*\)\s*/g, " ").trim());
      const cost = costText(cells[costIdx]);
      if (!item || !cost || cost === "…") continue;
      const historical = /\(historical\)/i.test(vendor);
      const existing = sales.get(item);
      // A current vendor always wins over a historical one.
      if (!existing || (existing.historical && !historical)) sales.set(item, { vendor, cost, limit, historical });
    }
  }
}

async function crawlVendorSales(page, extraVendors = []) {
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
  extraVendors.forEach((v) => vendors.add(v));
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
        acq.add(sale.historical ? "vendor-past" : "vendor");
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

// Black Lion weapon-skin sets that were released with a festival ("... was
// introduced for Shadow of the Mad King 2016 with the ... update"). They aren't
// festival items (Black Lion Chests / the Weapons Specialist), but each awards
// a "<Set> Weapon Collection" achievement and belongs to that festival's lineup.
const BL_FESTIVALS = [
  [/Shadow of the Mad King|Blood and Madness|Halloween/i, "halloween"],
  [/Wintersday/i, "wintersday"],
  [/Dragon Bash/i, "dragon-bash"],
  [/Lunar New Year/i, "lunar-new-year"],
  [/Super Adventure/i, "super-adventure-box"],
  [/Four Winds|Bazaar/i, "four-winds"],
];
const blFestivalKey = (text) => BL_FESTIVALS.find(([re]) => re.test(text))?.[1] ?? null;

async function crawlBlackLionSets() {
  const titles = new Set();
  for (const q of ['"set of Black Lion weapon skins"', '"Black Lion weapon skins"']) {
    let off = 0;
    for (;;) {
      const hits = await searchTitles(q, off);
      hits.titles.forEach((t) => titles.add(t));
      if (hits.next == null) break;
      off = hits.next;
    }
  }
  const sets = [];
  for (const title of [...titles].filter((t) => / weapon skins$/.test(t))) {
    const html = await parsePageHtml(title);
    await sleep(40);
    if (!html) continue;
    const intro = strip(html.slice(0, 4500));
    const m = intro.match(/introduced for (?:the )?(.+?) (\d{4}) with the/);
    const byTitle = title.match(/^(Wintersday|Winter's|Toy|Blood and Madness|Shadow of the Mad King|Dragon Bash|Lunar New Year|Halloween) weapon skins$/);
    const label = m ? `${m[1]} ${m[2]}` : byTitle ? (/^(Winter's|Toy)$/.test(byTitle[1]) ? "Wintersday" : byTitle[1]) : null;
    const key = label ? blFestivalKey(label) : null;
    if (!key) continue;
    const collection = intro.match(/awards the (.+?) achievement/)?.[1] ?? intro.match(/Collection\s+(.+?)\s+(?:Total skins|Release)/)?.[1] ?? null;
    const released = intro.match(/Release\s+([A-Z][a-z]+ \d{1,2}, \d{4})/)?.[1] ?? null;
    const members = (await getCategoryMembers(`Category:${title}`, { cmtype: "page" })).map((x) => normalizeTitle(x.title)).filter((n) => n !== title);
    await sleep(40);
    sets.push({ title, key, label, collection, released, members });
  }
  console.log(`Black Lion sets tied to a festival: ${sets.map((s) => `${s.title} (${s.label})`).join("; ")}`);
  return sets;
}

// 4. Official achievements API.
//  a) Items rewarded by festival achievements. The API has no "festival"
//     achievement group (they sit in Historical / Daily / Bonus Events), so
//     categories are picked by name.
//  b) Collection achievements (categories Rare / Black Lion / Basic /
//     Festival Collections). Their pieces are skins, minis and items; each
//     collection is assigned to a festival by name (Festival Collections only)
//     or by which festival's tab already holds most of its pieces.
const ACH_CATEGORIES = {
  halloween: /Halloween|Mad King|Blood and Madness|Lunatic/i,
  wintersday: /Wintersday|Winter's Presence|Tixx/i,
  "lunar-new-year": /Lunar New Year|New Year's Customs|Dragon Ball/i,
  "dragon-bash": /Dragon Bash/i,
  "four-winds": /Four Winds|Bazaar|Jubilee|Queen's Gauntlet|Crown Pavilion/i,
  "super-adventure-box": /Super Adventure/i,
};
// "Festival Collections" mixes every festival, so those are split by name.
const FESTIVAL_COLLECTION_NAMES = {
  halloween: /Royal Flame|Mad Armory|Lunatic|Tricks and Treats/i,
  wintersday: /Goldclaw|Rimed|Toy|Winter|Children/i,
  "super-adventure-box": /Glitched|Crimson|Kaiser|Super Adventure|Storm Wizard|King Toad/i,
};
const COLLECTION_CATEGORIES = ["Rare Collections", "Black Lion Collections", "Basic Collections", "Festival Collections"];

// Turns an API item into the wardrobe pieces it unlocks: [{ kind, id }].
function makeResolver({ skinsById, skinsByName, minisById, novelties }) {
  const novByItem = new Map();
  for (const n of novelties) for (const i of n.unlock_item ?? []) novByItem.set(i, n);
  return (it) => {
    if (it.type === "MiniPet" && minisById.has(it.details?.minipet_id)) return [{ kind: "mini", id: it.details.minipet_id }];
    if (["Back", "Weapon", "Armor"].includes(it.type) && skinsById.has(it.default_skin)) return [{ kind: "skin", id: it.default_skin }];
    if (novByItem.has(it.id)) return [{ kind: "novelty", id: novByItem.get(it.id).id }];
    if (it.type === "Consumable" && it.details?.type === "Unlock") {
      // Skin-unlock consumables ("King Toad's Backpack Cover", "... Skin"): match by skin name.
      const base = it.name.replace(/ (Skin|Cover)$/, "");
      return (skinsByName.get(base) ?? skinsByName.get(`${base}s`) ?? []).map((s) => ({ kind: "skin", id: s.id }));
    }
    return [];
  };
}

const newPieces = () => ({ skins: new Map(), minis: new Map(), novelties: new Map() });
function addPiece(pieces, p, achName, kind) {
  const map = p.kind === "skin" ? pieces.skins : p.kind === "mini" ? pieces.minis : pieces.novelties;
  if (!map.has(p.id)) map.set(p.id, { ach: new Set(), kinds: new Set() });
  map.get(p.id).ach.add(achName);
  map.get(p.id).kinds.add(kind);
}

async function crawlAchievementRewards(cats, resolve) {
  const out = new Map(FESTIVALS.map((f) => [f.key, newPieces()]));
  const festOf = new Map(); // achievement id -> festival key
  for (const c of cats) {
    for (const [key, re] of Object.entries(ACH_CATEGORIES)) if (re.test(c.name)) c.achievements.forEach((a) => festOf.set(a, key));
  }
  const achs = await fetchAll("achievements", [...festOf.keys()]);
  const rewardItemIds = new Set(achs.flatMap((a) => (a.rewards ?? []).filter((r) => r.type === "Item").map((r) => r.id)));
  const rewardItems = new Map((await fetchAll("items", [...rewardItemIds])).map((i) => [i.id, i]));
  for (const a of achs) {
    for (const r of a.rewards ?? []) {
      const it = r.type === "Item" ? rewardItems.get(r.id) : null;
      if (it) resolve(it).forEach((p) => addPiece(out.get(festOf.get(a.id)), p, a.name, "reward"));
    }
  }
  console.log(`Read ${achs.length} festival achievements for item rewards.`);
  return out;
}

// Every collection achievement with at least one resolvable piece.
async function crawlCollections(cats, resolve, skinsById, minisById) {
  const catIds = cats.filter((c) => COLLECTION_CATEGORIES.includes(c.name));
  const festivalCol = new Set(cats.find((c) => c.name === "Festival Collections")?.achievements ?? []);
  const achs = await fetchAll("achievements", [...new Set(catIds.flatMap((c) => c.achievements))]);
  const itemIds = new Set(
    achs.flatMap((a) => [
      ...(a.bits ?? []).filter((b) => b.type === "Item").map((b) => b.id),
      ...(a.rewards ?? []).filter((r) => r.type === "Item").map((r) => r.id),
    ])
  );
  const items = new Map((await fetchAll("items", [...itemIds])).map((i) => [i.id, i]));

  const collections = [];
  for (const a of achs) {
    const pieces = newPieces();
    for (const b of a.bits ?? []) {
      if (b.type === "Skin" && skinsById.has(b.id)) addPiece(pieces, { kind: "skin", id: b.id }, a.name, "collection");
      else if (b.type === "Minipet" && minisById.has(b.id)) addPiece(pieces, { kind: "mini", id: b.id }, a.name, "collection");
      else if (b.type === "Item" && items.has(b.id)) resolve(items.get(b.id)).forEach((p) => addPiece(pieces, p, a.name, "collection"));
    }
    // What completing the collection awards (e.g. the Mad Armory weapons).
    for (const r of a.rewards ?? []) {
      if (r.type === "Item" && items.has(r.id)) resolve(items.get(r.id)).forEach((p) => addPiece(pieces, p, a.name, "collection"));
    }
    const total = pieces.skins.size + pieces.minis.size + pieces.novelties.size;
    if (total) collections.push({ id: a.id, name: a.name, inFestivalCategory: festivalCol.has(a.id), pieces, total });
  }
  console.log(`Read ${collections.length} collection achievements with resolvable pieces.`);
  return collections;
}

async function main() {
  const skins = JSON.parse(await readFile(path.join(DATA, "skins.json"), "utf8"));
  const skinNames = new Set(skins.map((s) => s.name));
  const skinsById = new Map(skins.map((s) => [s.id, s]));
  const skinsByName = new Map();
  for (const s of skins) skinsByName.set(s.name, [...(skinsByName.get(s.name) ?? []), s]);

  console.log("Fetching minis and novelties from the API...");
  const minis = await fetchAll("minis", await fetchJson(`${API}/minis`));
  const novelties = await fetchAll("novelties", await fetchJson(`${API}/novelties`));
  const unlockItemIds = [...new Set(novelties.flatMap((n) => n.unlock_item ?? []))];
  const itemNames = new Map((await fetchAll("items", unlockItemIds)).map((i) => [i.id, i.name]));

  const minisById = new Map(minis.map((m) => [m.id, m]));
  const noveltiesById = new Map(novelties.map((n) => [n.id, n]));
  const resolve = makeResolver({ skinsById, skinsByName, minisById, novelties });
  const achCats = await fetchJson(`${API}/achievements/categories?ids=all&lang=en`);
  const rewardsByFest = await crawlAchievementRewards(achCats, resolve);
  const collections = await crawlCollections(achCats, resolve, skinsById, minisById);
  const blackLionSets = await crawlBlackLionSets();

  const byName = (a, b) => a.name.localeCompare(b.name);
  const outFestivals = [];

  // Adds a set of achievement pieces to a festival's lists (creating entries the
  // wiki crawl didn't have) and tags each with its achievement names.
  const mergePieces = (fest, pieces, catLabel) => {
    let added = 0;
    let tagged = 0;
    const tag = (entry, info) => {
      const keys = [...info.kinds].map((k) => (k === "collection" ? "collection" : "achievement-reward"));
      entry.acq = [...new Set([...(entry.acq ?? []), ...keys])];
      entry.ach = [...new Set([...(entry.ach ?? []), ...info.ach])].slice(0, 4);
      tagged++;
    };
    for (const [id, info] of pieces.skins) {
      let e = fest.skins.find((x) => x.id === id);
      if (!e) {
        const s = skinsById.get(id);
        e = { id: s.id, name: s.name, type: s.type, rarity: s.rarity, weight_class: s.details?.weight_class ?? null, icon: s.icon ?? null, cats: [catLabel] };
        fest.skins.push(e);
        added++;
      }
      tag(e, info);
    }
    for (const [id, info] of pieces.minis) {
      let e = fest.minis.find((x) => x.id === id);
      if (!e) {
        const m = minisById.get(id);
        e = { id: m.id, name: m.name, icon: m.icon ?? null, item_id: m.item_id ?? null, cats: [catLabel] };
        fest.minis.push(e);
        added++;
      }
      tag(e, info);
    }
    for (const [id, info] of pieces.novelties) {
      let e = fest.novelties.find((x) => x.id === id);
      if (!e) {
        const n = noveltiesById.get(id);
        e = { id: n.id, name: n.name, slot: n.slot ?? null, icon: n.icon ?? null, cats: [catLabel] };
        fest.novelties.push(e);
        added++;
      }
      tag(e, info);
    }
    fest.skins.sort(byName);
    fest.minis.sort(byName);
    fest.novelties.sort(byName);
    return { added, tagged };
  };

  for (const f of FESTIVALS) {
    console.log(`\n== ${f.label} ==`);
    const titles = new Map();
    const seeds = f.seeds ?? [];
    const allSeeds = [`Category:${f.page}`, `Category:Gem Store ${f.page} items`, `Category:${f.page} miniatures`, ...seeds];
    const visited = await crawlCategories(allSeeds, titles);
    const items = await crawlItemsPage(f.page, titles);
    // Festivals without an /items page (Super Adventure Box) still have one
    // "<Set> weapons" category per set; those categories are the set list.
    const years = await crawlYearPages(f, titles);
    const catSets = [...visited].map((c) => c.replace(/^Category:/, "")).filter((n) => / weapons$/.test(n) && n !== `${f.page} weapons`);
    // Sets found only on a year page must say they're festival weapons - those
    // pages also link unrelated sets (WvW/sPvP Obsidian, Officer's Remnant, ...).
    const known = new Set([...items.setTitles, ...catSets]);
    const yearSets = [];
    for (const t of years.setTitles) {
      if (known.has(t)) continue;
      const intro = strip(((await parsePageHtml(t)) ?? "").slice(0, 3000));
      await sleep(40);
      if (/Festival weapons/.test(intro)) yearSets.push(t);
    }
    const setTitles = [...new Set([...known, ...yearSets])];
    console.log(`  ${visited.size} categories, +${items.added} titles from ${f.page}/items, +${years.added} from ${years.pages} year pages, ${setTitles.length} weapon sets`);

    const { sales, vendorCount } = await crawlVendorSales(f.page, f.extraVendors);
    console.log(`  ${sales.size} vendor sale rows from ${vendorCount} vendor pages`);

    const setAcq = await crawlWeaponSets(setTitles, sales, f, skinNames);
    for (const [name, info] of setAcq) addTitle(titles, name, info.set);
    const weaponAcq = f.weaponCategory ? await crawlWeaponCategory(f.weaponCategory, f) : new Map();

    const labelFor = (name) => [...(titles.get(name) ?? [])].slice(0, 4);
    const saleFor = (name) => {
      const s = sales.get(name);
      return s ? { acq: [s.historical ? "vendor-past" : "vendor"], vendor: { name: s.vendor, cost: s.cost, item: null, limit: s.limit, festival: f.label } } : null;
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

    // Black Lion weapon sets introduced for this festival.
    let blAdded = 0;
    for (const set of blackLionSets.filter((s) => s.key === f.key)) {
      for (const name of new Set(set.members)) {
        for (const s of skinsByName.get(resolveSkinName(name, skinNames)) ?? []) {
          let e = fSkins.find((x) => x.id === s.id);
          if (!e) {
            e = { id: s.id, name: s.name, type: s.type, rarity: s.rarity, weight_class: s.details?.weight_class ?? null, icon: s.icon ?? null, cats: [set.title] };
            fSkins.push(e);
            blAdded++;
          }
          e.set ??= set.title;
          e.released ??= set.released;
          e.blackLion = set.label;
          e.acq = [...new Set([...(e.acq ?? []), "black-lion", ...(set.collection ? ["collection"] : [])])];
          if (set.collection) e.ach = [...new Set([...(e.ach ?? []), set.collection])].slice(0, 4);
        }
      }
    }
    if (blAdded) fSkins.sort(byName);
    if (blackLionSets.some((s) => s.key === f.key)) console.log(`  black lion sets: ${blackLionSets.filter((s) => s.key === f.key).map((s) => s.title).join("; ")} (+${blAdded} new)`);

    const rewards = mergePieces({ skins: fSkins, minis: fMinis, novelties: fNovelties }, rewardsByFest.get(f.key), "Achievement reward");
    console.log(`  achievement rewards: ${rewards.tagged} items tagged, ${rewards.added} new to this tab`);

    const missing = [...setAcq.keys()].filter((n) => !skinNames.has(n));
    if (missing.length) console.log(`  set weapons with no API skin: ${missing.join(", ")}`);
    const vendorCount2 = [...fSkins, ...fMinis, ...fNovelties].filter((i) => i.acq?.includes("vendor")).length;
    console.log(`  => ${fSkins.length} skins, ${fMinis.length} minis, ${fNovelties.length} novelties (${vendorCount2} sold by a festival vendor)`);

    outFestivals.push({ key: f.key, label: f.label, emoji: f.emoji, page: f.page, skins: fSkins, minis: fMinis, novelties: fNovelties });
  }

  // Collections: a collection belongs to the festival named for it (Festival
  // Collections category only) or, failing that, the festival whose tab already
  // holds at least half of its pieces. Then all of its pieces join that tab.
  console.log("\n== Collections ==");
  const idsOf = (o) => ({ skins: new Set(o.skins.map((x) => x.id)), minis: new Set(o.minis.map((x) => x.id)), novelties: new Set(o.novelties.map((x) => x.id)) });
  const tabIds = new Map(outFestivals.map((o) => [o.key, idsOf(o)]));
  const assigned = new Map(outFestivals.map((o) => [o.key, []]));
  for (const c of collections) {
    let key = null;
    if (c.inFestivalCategory) key = Object.entries(FESTIVAL_COLLECTION_NAMES).find(([, re]) => re.test(c.name))?.[0] ?? null;
    if (!key && c.total >= 3) {
      let best = 0;
      for (const [k, ids] of tabIds) {
        const hit = [...c.pieces.skins.keys()].filter((i) => ids.skins.has(i)).length + [...c.pieces.minis.keys()].filter((i) => ids.minis.has(i)).length + [...c.pieces.novelties.keys()].filter((i) => ids.novelties.has(i)).length;
        if (hit / c.total >= 0.5 && hit / c.total > best) {
          best = hit / c.total;
          key = k;
        }
      }
    }
    if (key) assigned.get(key).push(c);
  }
  for (const o of outFestivals) {
    const cols = assigned.get(o.key);
    if (!cols.length) continue;
    const merged = newPieces();
    for (const c of cols) for (const kind of ["skins", "minis", "novelties"]) for (const [id, info] of c.pieces[kind]) {
      if (!merged[kind].has(id)) merged[kind].set(id, { ach: new Set(), kinds: new Set() });
      info.ach.forEach((a) => merged[kind].get(id).ach.add(a));
      merged[kind].get(id).kinds.add("collection");
    }
    const r = mergePieces(o, merged, "Collection achievement");
    console.log(`  ${o.label}: ${cols.length} collections (${cols.map((c) => c.name).join("; ")}) -> ${r.tagged} items tagged, ${r.added} new`);
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
