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
import { getCategoryMembers } from "./wikiApi.mjs";

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
  return title.replace(/ \((light|medium|heavy) skin\)$/, "").replace(/ Skin$/, "");
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

  const skins = JSON.parse(await readFile(path.join(DATA, "skins.json"), "utf8"));
  const haloSkins = skins
    .filter((s) => titles.has(s.name))
    .map((s) => ({
      id: s.id,
      name: s.name,
      type: s.type,
      rarity: s.rarity,
      weight_class: s.details?.weight_class ?? null,
      icon: s.icon ?? null,
      cats: cats(s.name),
    }));

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
  console.log(`Wrote ${path.join(DATA, "halloween.json")}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
