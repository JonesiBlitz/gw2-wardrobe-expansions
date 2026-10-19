// Merges data/skins-by-expansion.json (wiki-category matches) and
// data/unmatched-release-dates.json (wiki-date-inferred era for everything
// else) into one dataset grouped by coarse "release window" (see
// src/windows.mjs), and writes it as a browser-loadable JS file for web/.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CORE_TYRIA } from "./expansions.mjs";
import { WINDOWS, UNKNOWN_WINDOW, windowKeyForEraKey, eraForDate } from "./windows.mjs";
import { resolveSkinDate } from "./skinTitle.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(__dirname, "..", "data");
const WEB = path.join(__dirname, "..", "web");

async function main() {
  const byExpansion = JSON.parse(await readFile(path.join(DATA, "skins-by-expansion.json"), "utf8"));
  const plainDates = JSON.parse(await readFile(path.join(DATA, "unmatched-release-dates.json"), "utf8"));
  const weightClassDates = JSON.parse(
    await readFile(path.join(DATA, "weight-class-release-dates.json"), "utf8").catch(() => "{}")
  );

  const windowMap = new Map(
    [...WINDOWS, UNKNOWN_WINDOW].map((w) => [w.key, { key: w.key, label: w.label, from: w.from, to: w.to, skins: [] }])
  );

  for (const [bucketKey, bucket] of Object.entries(byExpansion)) {
    if (bucketKey === CORE_TYRIA.key) {
      for (const skin of bucket.skins) {
        const info = resolveSkinDate(skin, plainDates, weightClassDates);
        if (!info || info.missing || !info.timestamp) {
          windowMap.get(UNKNOWN_WINDOW.key).skins.push({
            ...skin,
            source: "unknown",
            sourceLabel: "No wiki page found",
            wikiFirstSeen: null,
          });
          continue;
        }
        const era = eraForDate(info.timestamp);
        const wKey = windowKeyForEraKey(era.key);
        const viaNote = info.via === "weight-class-title" ? " (via weight-class page)" : "";
        windowMap.get(wKey).skins.push({
          ...skin,
          source: "date-inferred",
          sourceLabel: `Inferred: ${era.label} era (wiki page first seen)${viaNote}`,
          wikiFirstSeen: info.timestamp,
        });
      }
    } else {
      const wKey = windowKeyForEraKey(bucketKey);
      const target = windowMap.get(wKey) ?? windowMap.get(UNKNOWN_WINDOW.key);
      for (const skin of bucket.skins) {
        target.skins.push({
          ...skin,
          source: "wiki-category",
          sourceLabel: `${bucket.label} (wiki-tagged)`,
          wikiFirstSeen: null,
        });
      }
    }
  }

  const windows = [...WINDOWS, UNKNOWN_WINDOW].map((w) => {
    const entry = windowMap.get(w.key);
    entry.skins.sort((a, b) => a.name.localeCompare(b.name));
    entry.count = entry.skins.length;
    return entry;
  });

  const totalSkins = windows.reduce((sum, w) => sum + w.count, 0);

  // Event view (not a release window - its skins also appear in their window tab).
  const halloween = JSON.parse(await readFile(path.join(DATA, "halloween.json"), "utf8").catch(() => "null"));
  if (halloween) {
    const label = (x) => `Halloween: ${x.cats.join(", ") || "wiki-tagged"}`;
    const items = [
      ...halloween.skins.map((s) => ({ ...s, kind: "skin", source: "event", sourceLabel: label(s), wikiFirstSeen: null })),
      ...halloween.minis.map((m) => ({
        ...m, kind: "mini", type: "Mini", rarity: null, weight_class: null, source: "event", sourceLabel: label(m), wikiFirstSeen: null,
      })),
      ...halloween.novelties.map((n) => ({
        ...n, kind: "novelty", type: "Novelty", rarity: null, weight_class: n.slot, source: "event", sourceLabel: label(n), wikiFirstSeen: null,
      })),
    ].sort((a, b) => a.name.localeCompare(b.name));
    windows.push({
      key: "halloween",
      label: "🎃 Halloween event",
      from: null,
      to: null,
      event: true,
      note: "Shadow of the Mad King / Blood and Madness skins, minis and novelties. These span every era - skins here also appear in their release-window tab.",
      count: items.length,
      skins: items,
    });
  }

  const payload = { generatedAt: new Date().toISOString(), totalSkins, windows };

  await mkdir(WEB, { recursive: true });
  await writeFile(path.join(WEB, "data.js"), `window.GW2_WARDROBE_DATA = ${JSON.stringify(payload)};\n`);
  await writeFile(path.join(DATA, "skins-by-window.json"), JSON.stringify(payload, null, 2));

  console.log(`Total skins: ${totalSkins}`);
  for (const w of windows) console.log(`  ${w.label}: ${w.count}`);
  console.log(`\nWrote web/data.js and data/skins-by-window.json`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
