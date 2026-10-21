// Dates every mini and novelty in the API so they can sit in the same release
// windows as skins. Same two signals as skins (see classifySkins.mjs /
// fetchReleaseDates.mjs):
//   1. wiki-category: the item's wiki page is tagged "<Expansion> content"
//      (data/wiki-title-map.json), i.e. the wiki says which release added it.
//   2. date-inferred: the page's first-ever revision timestamp, slotted into
//      whichever release was current then.
// Novelties are looked up by their own name, then by the name of the item
// that unlocks them (the two often differ). Anything with neither signal is
// left undated. Writes data/minis-novelties.json.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getFirstRevisionTimestamps } from "./wikiApi.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(__dirname, "..", "data");
const API = "https://api.guildwars2.com/v2";

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

async function main() {
  const titleMap = JSON.parse(await readFile(path.join(DATA, "wiki-title-map.json"), "utf8"));

  console.log("Fetching minis and novelties from the API...");
  const minis = await fetchAll("minis", await fetchJson(`${API}/minis`));
  const novelties = await fetchAll("novelties", await fetchJson(`${API}/novelties`));
  const unlockItemIds = [...new Set(novelties.flatMap((n) => n.unlock_item ?? []))];
  const itemNames = new Map((await fetchAll("items", unlockItemIds)).map((i) => [i.id, i.name]));

  // The API contains unreleased/placeholder entries named like "((208738))".
  const isReal = (x) => !/^\(\(\d+\)\)$/.test(x.name);
  const items = [
    ...minis.filter(isReal).map((m) => ({
      kind: "mini",
      id: m.id,
      name: m.name,
      icon: m.icon ?? null,
      slot: null,
      candidates: [m.name],
    })),
    ...novelties.filter(isReal).map((n) => ({
      kind: "novelty",
      id: n.id,
      name: n.name,
      icon: n.icon ?? null,
      slot: n.slot ?? null,
      candidates: [...new Set([n.name, ...(n.unlock_item ?? []).map((id) => itemNames.get(id)).filter(Boolean)])],
    })),
  ];

  // 1. Wiki release-category tags.
  for (const it of items) {
    const hitName = it.candidates.find((c) => titleMap[c]);
    if (hitName) it.category = { bucket: titleMap[hitName].bucket, via: titleMap[hitName].via, title: hitName };
  }
  const tagged = items.filter((i) => i.category).length;

  // 2. First-revision dates for everything not tagged.
  const need = [...new Set(items.filter((i) => !i.category).flatMap((i) => i.candidates))];
  console.log(`${tagged} of ${items.length} tagged by wiki category; dating ${need.length} titles by first revision...`);
  const dates = await getFirstRevisionTimestamps(need, {
    onProgress: (done, total) => {
      if (done % 200 === 0 || done === total) process.stdout.write(`\r  ${done}/${total}`);
    },
  });
  console.log();

  let dated = 0;
  for (const it of items) {
    if (it.category) continue;
    for (const c of it.candidates) {
      const d = dates.get(c);
      if (d && !d.missing && d.timestamp) {
        it.wikiFirstSeen = d.timestamp;
        it.datedVia = c;
        dated++;
        break;
      }
    }
  }
  console.log(`Dated ${dated}; undated ${items.length - tagged - dated}.`);

  for (const it of items) delete it.candidates;
  await writeFile(path.join(DATA, "minis-novelties.json"), JSON.stringify({ generatedAt: new Date().toISOString(), items }, null, 2));
  console.log(`Wrote ${path.join(DATA, "minis-novelties.json")}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
