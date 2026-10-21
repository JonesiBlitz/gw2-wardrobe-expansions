// For every skin that classifySkins.mjs couldn't tie to a specific
// expansion/LW season (the "Core Tyria & non-expansion releases" bucket),
// fetch the wiki article's FIRST revision timestamp as an approximate
// "date added to the game", and write data/unmatched-release-dates.json.
//
// This is a proxy, not ground truth: wiki articles are usually created
// within days of an item's real release, but can lag (especially for
// obscure items nobody documented right away) or lead it (datamined before
// release). See README.md.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getFirstRevisionTimestamps } from "./wikiApi.mjs";
import { CORE_TYRIA } from "./expansions.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(__dirname, "..", "data");

async function main() {
  const byExpansion = JSON.parse(await readFile(path.join(DATA, "skins-by-expansion.json"), "utf8"));
  const unmatchedNames = [...new Set(byExpansion[CORE_TYRIA.key].skins.map((s) => s.name))];

  // A page's first revision never changes, so only look up names we haven't
  // already found (pages that were missing last time are retried).
  const cache = JSON.parse(await readFile(path.join(DATA, "unmatched-release-dates.json"), "utf8").catch(() => "{}"));
  const todo = unmatchedNames.filter((n) => !(cache[n] && !cache[n].missing));
  console.log(`Looking up first-revision dates for ${todo.length} of ${unmatchedNames.length} unmatched skin names (${unmatchedNames.length - todo.length} cached)...`);
  const fresh = await getFirstRevisionTimestamps(todo, {
    onProgress: (done, total) => {
      if (done % 200 === 0 || done === total) process.stdout.write(`\r  ${done}/${total}`);
    },
  });
  console.log();

  // Cached hits plus fresh lookups, restricted to names still in the bucket.
  const dates = new Map(unmatchedNames.map((n) => [n, fresh.get(n) ?? cache[n]]));
  let found = 0;
  let missing = 0;
  for (const v of dates.values()) (v.missing ? missing++ : found++);
  console.log(`Found wiki pages for ${found}, no wiki page for ${missing}.`);

  await writeFile(
    path.join(DATA, "unmatched-release-dates.json"),
    JSON.stringify(Object.fromEntries(dates), null, 2)
  );
  console.log(`Wrote ${path.join(DATA, "unmatched-release-dates.json")}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
