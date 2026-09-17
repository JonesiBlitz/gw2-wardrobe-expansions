// Joins data/unmatched-release-dates.json (wiki first-revision timestamps)
// against the "Core Tyria & non-expansion releases" bucket and assigns each
// skin an inferred "era" - the release window its wiki page's creation date
// falls into, per the chronological TIMELINE in expansions.mjs.
//
// This does NOT mean these skins were added BY that expansion (most are
// Gem Store / crafted / dungeon / PvP / festival content unrelated to any
// expansion's story) - it just tells you what was current when they showed
// up, which is the closest thing to a release-date answer available.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TIMELINE, CORE_TYRIA } from "./expansions.mjs";
import { eraForDate as eraForDateShared } from "./windows.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(__dirname, "..", "data");
const OUT = path.join(__dirname, "..", "out");

function csvEscape(v) {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function main() {
  const byExpansion = JSON.parse(await readFile(path.join(DATA, "skins-by-expansion.json"), "utf8"));
  const dates = JSON.parse(await readFile(path.join(DATA, "unmatched-release-dates.json"), "utf8"));

  const timeline = TIMELINE.filter((b) => b.released);
  const unmatched = byExpansion[CORE_TYRIA.key].skins;

  const eraCounts = new Map();
  const rows = [];
  let dated = 0;
  let noPage = 0;

  for (const skin of unmatched) {
    const info = dates[skin.name];
    if (!info || info.missing || !info.timestamp) {
      noPage++;
      rows.push({ ...skin, wikiFirstSeen: null, era: "unknown (no wiki page found)" });
      eraCounts.set("unknown (no wiki page found)", (eraCounts.get("unknown (no wiki page found)") ?? 0) + 1);
      continue;
    }
    dated++;
    const era = eraForDateShared(info.timestamp);
    rows.push({ ...skin, wikiFirstSeen: info.timestamp, era: era.label });
    eraCounts.set(era.label, (eraCounts.get(era.label) ?? 0) + 1);
  }

  rows.sort((a, b) => (a.wikiFirstSeen ?? "9999").localeCompare(b.wikiFirstSeen ?? "9999"));

  const csvRows = ["id,name,type,rarity,weight_class,wiki_first_seen,inferred_era"];
  for (const r of rows) {
    csvRows.push(
      [r.id, r.name, r.type, r.rarity, r.weight_class ?? "", r.wikiFirstSeen ?? "", r.era]
        .map(csvEscape)
        .join(",")
    );
  }
  await writeFile(path.join(OUT, "unmatched-by-era.csv"), csvRows.join("\n"));

  const order = [...timeline.map((b) => b.label), "unknown (no wiki page found)"];
  const mdLines = [
    "# Non-expansion skins, by inferred era (wiki page creation date)",
    "",
    `${unmatched.length} skins in "Core Tyria & non-expansion releases". Dated via wiki first-revision timestamp: ${dated}. No wiki page found: ${noPage}.`,
    "",
    "This is an approximate \"what was current when this skin's wiki page was created\" grouping, not an official release-by-expansion mapping - see README.md.",
    "",
    "| Era | Skins |",
    "|---|---:|",
  ];
  for (const label of order) {
    if (!eraCounts.has(label)) continue;
    mdLines.push(`| ${label} | ${eraCounts.get(label)} |`);
  }
  await writeFile(path.join(OUT, "unmatched-by-era.md"), mdLines.join("\n") + "\n");

  console.log(mdLines.join("\n"));
  console.log(`\nWrote out/unmatched-by-era.csv, out/unmatched-by-era.md`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
