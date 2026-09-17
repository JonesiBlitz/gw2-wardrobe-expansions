// Release buckets, in chronological order. `prefix` is the exact string GW2
// Wiki uses for its per-release categories, e.g. "Category:Path of Fire
// armor sets" / "Category:Path of Fire content".
// "Core Tyria" is not listed here: it's the fallback for any skin that
// doesn't turn up in any release-specific category (base game + launch
// content generally isn't wiki-tagged with a release category at all).
export const EXPANSIONS = [
  { key: "heart-of-thorns", label: "Heart of Thorns", prefix: "Heart of Thorns", released: "2015-10-23" },
  { key: "living-world-s2", label: "Living World Season 2", prefix: "Living World Season 2", released: "2015-01-27" },
  { key: "living-world-s3", label: "Living World Season 3", prefix: "Living World Season 3", released: "2017-07-25" },
  { key: "path-of-fire", label: "Path of Fire", prefix: "Path of Fire", released: "2017-09-22" },
  { key: "living-world-s4", label: "Living World Season 4", prefix: "Living World Season 4", released: "2018-03-06" },
  { key: "icebrood-saga", label: "The Icebrood Saga", prefix: "The Icebrood Saga", released: "2019-11-26" },
  { key: "end-of-dragons", label: "End of Dragons", prefix: "End of Dragons", released: "2022-02-28" },
  { key: "secrets-of-the-obscure", label: "Secrets of the Obscure", prefix: "Secrets of the Obscure", released: "2023-08-22" },
  { key: "janthir-wilds", label: "Janthir Wilds", prefix: "Janthir Wilds", released: "2024-08-20" },
  { key: "visions-of-eternity", label: "Visions of Eternity", prefix: "Visions of Eternity", released: "2025-10-28" },
];

// Living World Season 1 predates Heart of Thorns and was later made free;
// kept separate since the wiki also tracks it separately and it has no
// "armor/weapon sets" category of its own (content-only).
export const LIVING_WORLD_S1 = { key: "living-world-s1", label: "Living World Season 1", prefix: "Living World Season 1", released: "2013-04-30" };

// Catch-all for anything the wiki doesn't tag with a release-specific
// category: core/launch skins, but also (the large majority in practice)
// skins added on an ongoing basis outside any expansion's story content -
// Gem Store releases, crafted/dungeon/fractal/raid-vendor sets, PvP/WvW
// rewards, seasonal festivals, etc. See README.md "Accuracy & caveats".
export const CORE_TYRIA = { key: "core-tyria", label: "Core Tyria & non-expansion releases", prefix: null, released: "2012-08-28" };

export const ALL_BUCKETS = [LIVING_WORLD_S1, ...EXPANSIONS];

// Same buckets (plus Core Tyria), in true chronological release order - used
// to map a raw date (e.g. a wiki page's first-revision timestamp) onto "which
// era did this release in" for content the wiki never tagged with a release
// category in the first place (see fetchReleaseDates.mjs / mapEras.mjs).
const byKey = new Map([CORE_TYRIA, LIVING_WORLD_S1, ...EXPANSIONS].map((b) => [b.key, b]));
export const TIMELINE = [
  "core-tyria",
  "living-world-s1",
  "living-world-s2",
  "heart-of-thorns",
  "living-world-s3",
  "path-of-fire",
  "living-world-s4",
  "icebrood-saga",
  "end-of-dragons",
  "secrets-of-the-obscure",
  "janthir-wilds",
  "visions-of-eternity",
].map((key) => byKey.get(key));
