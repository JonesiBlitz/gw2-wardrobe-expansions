// Joins data/skins.json (official GW2 API) against data/wiki-title-map.json
// (GW2 Wiki category crawl) by exact skin name, and writes:
//   data/skins-by-expansion.json  - full structured result
//   out/summary.csv               - flat id,name,type,rarity,bucket,via
//   out/counts.md                 - human-readable count table
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ALL_BUCKETS, CORE_TYRIA } from "./expansions.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(__dirname, "..", "data");
const OUT = path.join(__dirname, "..", "out");

const VIA_RANK = { set: 0, "set-direct": 1, content: 2 };

function csvEscape(v) {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function main() {
  const skins = JSON.parse(await readFile(path.join(DATA, "skins.json"), "utf8"));
  const titleMap = JSON.parse(await readFile(path.join(DATA, "wiki-title-map.json"), "utf8"));

  const bucketByKey = new Map([[CORE_TYRIA.key, CORE_TYRIA], ...ALL_BUCKETS.map((b) => [b.key, b])]);
  const result = new Map(
    [CORE_TYRIA, ...ALL_BUCKETS].map((b) => [b.key, { ...b, count: 0, viaCounts: {}, skins: [] }])
  );

  let matched = 0;
  for (const skin of skins) {
    const hit = titleMap[skin.name];
    const bucketKey = hit ? hit.bucket : CORE_TYRIA.key;
    if (hit) matched++;

    const bucket = result.get(bucketKey);
    bucket.count++;
    const via = hit ? hit.via : "unmatched-default-core";
    bucket.viaCounts[via] = (bucket.viaCounts[via] ?? 0) + 1;
    bucket.skins.push({
      id: skin.id,
      name: skin.name,
      type: skin.type,
      rarity: skin.rarity,
      weight_class: skin.details?.weight_class ?? null,
      icon: skin.icon ?? null,
      via,
      set: hit?.set ?? null,
    });
  }

  for (const bucket of result.values()) {
    bucket.skins.sort((a, b) => a.name.localeCompare(b.name));
  }

  await writeFile(
    path.join(DATA, "skins-by-expansion.json"),
    JSON.stringify(Object.fromEntries(result), null, 2)
  );

  const csvRows = ["id,name,type,rarity,weight_class,bucket,via,set"];
  for (const bucket of result.values()) {
    for (const s of bucket.skins) {
      csvRows.push(
        [s.id, s.name, s.type, s.rarity, s.weight_class ?? "", bucket.label, s.via, s.set ?? ""]
          .map(csvEscape)
          .join(",")
      );
    }
  }
  await writeFile(path.join(OUT, "summary.csv"), csvRows.join("\n"));

  const order = [CORE_TYRIA.key, ...ALL_BUCKETS.map((b) => b.key)];
  const mdLines = [
    "# GW2 wardrobe skins by release",
    "",
    `Total skins: ${skins.length}. Matched to a specific release via wiki data: ${matched} (${((matched / skins.length) * 100).toFixed(1)}%).`,
    "",
    "| Release | Skins | via armor/weapon set | via content category |",
    "|---|---:|---:|---:|",
  ];
  for (const key of order) {
    const b = result.get(key);
    const viaSet = (b.viaCounts.set ?? 0) + (b.viaCounts["set-direct"] ?? 0);
    const viaContent = b.viaCounts.content ?? 0;
    mdLines.push(`| ${b.label} | ${b.count} | ${viaSet} | ${viaContent} |`);
  }
  await writeFile(path.join(OUT, "counts.md"), mdLines.join("\n") + "\n");

  console.log(mdLines.join("\n"));
  console.log(`\nWrote data/skins-by-expansion.json, out/summary.csv, out/counts.md`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
