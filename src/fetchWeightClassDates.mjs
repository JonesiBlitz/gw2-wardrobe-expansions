// Second pass for date inference: a lot of armor skin NAMES are reused
// across weight classes (e.g. "Angler Vest" is a separate Light, Medium and
// Heavy skin), so the wiki disambiguates them as "<Name> (light skin)",
// "<Name> (medium skin)", "<Name> (heavy skin)" - and the PLAIN name often
// isn't a real article at all, which is why fetchReleaseDates.mjs reported
// them all as "no wiki page found".
//
// This retries exactly those cases (Armor skins with a known weight_class
// whose plain-name lookup came back missing) against the weight-suffixed
// title, and writes data/weight-class-release-dates.json keyed by that
// suffixed title.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getFirstRevisionTimestamps } from "./wikiApi.mjs";
import { CORE_TYRIA } from "./expansions.mjs";
import { weightClassTitle } from "./skinTitle.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(__dirname, "..", "data");

async function main() {
  const byExpansion = JSON.parse(await readFile(path.join(DATA, "skins-by-expansion.json"), "utf8"));
  const plainDates = JSON.parse(await readFile(path.join(DATA, "unmatched-release-dates.json"), "utf8"));

  const candidates = new Set();
  for (const skin of byExpansion[CORE_TYRIA.key].skins) {
    if (skin.type !== "Armor" || !skin.weight_class) continue;
    const plain = plainDates[skin.name];
    if (plain && !plain.missing) continue; // plain title already resolved, nothing to retry
    candidates.add(weightClassTitle(skin.name, skin.weight_class));
  }
  const titles = [...candidates];

  console.log(`Retrying ${titles.length} weight-class-disambiguated titles (e.g. "Angler Vest (light skin)")...`);
  const dates = await getFirstRevisionTimestamps(titles, {
    onProgress: (done, total) => {
      if (done % 200 === 0 || done === total) process.stdout.write(`\r  ${done}/${total}`);
    },
  });
  console.log();

  let found = 0;
  for (const v of dates.values()) if (!v.missing) found++;
  console.log(`Found wiki pages for ${found} of ${titles.length} weight-suffixed titles.`);

  await writeFile(
    path.join(DATA, "weight-class-release-dates.json"),
    JSON.stringify(Object.fromEntries(dates), null, 2)
  );
  console.log(`Wrote ${path.join(DATA, "weight-class-release-dates.json")}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
