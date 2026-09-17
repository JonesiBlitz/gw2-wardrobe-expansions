// Crawls GW2 Wiki category structure to map article titles to the
// expansion/release that introduced them, then writes data/wiki-title-map.json.
//
// Strategy (see README.md for full rationale):
//  1. For each release, "<Release> armor sets" / "<Release> weapon sets" are
//     parent categories whose members are per-set subcategories (e.g.
//     "Category:Requiem armor"). Each subcategory's own page members are the
//     individual skin articles (e.g. "Requiem Coronet").
//  2. As a fallback for skins that aren't grouped into a "set" (single back
//     items, gathering tools, one-off weapons), we also scan "<Release>
//     content", which the wiki tags directly on articles - lower confidence
//     because it also contains non-skin pages (NPCs, achievements, etc.),
//     but it's the only signal available for those items and is filtered
//     down to actual skin names during the join step in classifySkins.mjs.
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getCategoryMembers } from "./wikiApi.mjs";
import { ALL_BUCKETS } from "./expansions.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_FILE = path.join(__dirname, "..", "data", "wiki-title-map.json");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function isNoiseTitle(title) {
  return / Skin$/.test(title) || /\((heavy|medium|light)\)$/.test(title);
}

async function crawlSetCategory(setCategoryName, bucketKey, via, map, stats) {
  const members = await getCategoryMembers(setCategoryName, { cmtype: "page" });
  for (const m of members) {
    if (isNoiseTitle(m.title)) continue;
    if (!map.has(m.title)) {
      map.set(m.title, { bucket: bucketKey, via, set: setCategoryName.replace(/^Category:/, "") });
      stats.set++;
    }
  }
}

async function crawlBucket(bucket, map, stats) {
  if (!bucket.prefix) return;

  for (const kind of ["armor sets", "weapon sets"]) {
    const catTitle = `Category:${bucket.prefix} ${kind}`;
    const subcats = await getCategoryMembers(catTitle, { cmtype: "subcat" });
    await sleep(50);
    for (const sub of subcats) {
      await crawlSetCategory(sub.title, bucket.key, "set", map, stats);
      await sleep(50);
    }
    // A handful of sets may be listed directly as pages rather than subcats.
    const directPages = await getCategoryMembers(catTitle, { cmtype: "page" });
    for (const p of directPages) {
      if (isNoiseTitle(p.title)) continue;
      if (!map.has(p.title)) {
        map.set(p.title, { bucket: bucket.key, via: "set-direct", set: catTitle });
        stats.set++;
      }
    }
    await sleep(50);
  }

  const contentTitle = `Category:${bucket.prefix} content`;
  const contentPages = await getCategoryMembers(contentTitle, { cmtype: "page" });
  for (const p of contentPages) {
    if (isNoiseTitle(p.title)) continue;
    if (!map.has(p.title)) {
      map.set(p.title, { bucket: bucket.key, via: "content" });
      stats.content++;
    }
  }
  await sleep(50);
}

async function main() {
  const map = new Map();
  const stats = { set: 0, content: 0 };

  for (const bucket of ALL_BUCKETS) {
    console.log(`Crawling ${bucket.label}...`);
    const before = map.size;
    await crawlBucket(bucket, map, stats);
    console.log(`  -> ${map.size - before} new titles (running total ${map.size})`);
  }

  console.log(`Done. ${map.size} titles mapped (${stats.set} via armor/weapon sets, ${stats.content} via content category).`);

  const obj = Object.fromEntries(map);
  await writeFile(OUT_FILE, JSON.stringify(obj, null, 2));
  console.log(`Wrote ${OUT_FILE}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
