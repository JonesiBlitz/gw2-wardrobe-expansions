# gw2-wardrobe-expansions

Buckets every GW2 wardrobe skin (armor, weapon, back item, gathering tool)
by the expansion / living-world release that introduced it, and ships a
browsable web page over the result.

## Browse it

```bash
npm run serve
```

then open <http://localhost:5175>. Tabs are "release windows" spanning one
expansion gap each (Core Tyria &rarr; Heart of Thorns, Heart of Thorns &rarr;
Path of Fire, ...), with search, a type filter (Armor/Weapon/Back/Gathering),
and a confidence filter. Each card links out to the skin's GW2 Wiki page.
Needs `npm run all` to have been run first so `web/data.js` exists.

## Why this needs two data sources

The official GW2 API's [`/v2/skins`](https://wiki.guildwars2.com/wiki/API:2/skins)
endpoint has no "expansion" or "release" field at all. The
[GW2 Wiki](https://wiki.guildwars2.com), however, tags articles with
categories like `Category:Path of Fire content` and groups skins into
per-release "set" categories like `Category:Path of Fire armor sets`. This
project crawls those wiki categories and joins the result back onto the
official API data by skin name.

## Pipeline

```bash
npm run fetch:skins   # -> data/skins.json                    (GW2 API: all 10k+ skins)
npm run fetch:wiki    # -> data/wiki-title-map.json            (GW2 Wiki: title -> release)
npm run build         # -> data/skins-by-expansion.json, out/summary.csv, out/counts.md
npm run fetch:dates   # -> data/unmatched-release-dates.json   (GW2 Wiki: title -> first-seen date)
npm run report:eras   # -> out/unmatched-by-era.csv, out/unmatched-by-era.md
# or just:
npm run all
```

1. **`fetchSkins.mjs`** pulls every skin id from `/v2/skins`, then fetches
   full details in batches of 200.
2. **`fetchWikiBuckets.mjs`** crawls, for each release in `src/expansions.mjs`:
   - `Category:<Release> armor sets` and `Category:<Release> weapon sets` -
     these are parent categories whose members are per-set *sub*categories
     (e.g. `Category:Requiem armor`), whose own page members are the actual
     individual skin articles (`Requiem Coronet`, `Requiem Gambeson`, ...).
     This two-level crawl is the high-confidence path (`via: "set"`).
   - `Category:<Release> content` - a flatter, lower-confidence fallback the
     wiki applies directly to standalone articles (single back items,
     one-off weapons not grouped into a "set", etc). Tagged `via: "content"`.
3. **`classifySkins.mjs`** joins `skins.json` to `wiki-title-map.json` by
   exact skin name and writes the final bucketed output.
4. **`fetchReleaseDates.mjs`** - for every skin that still landed in the
   "Core Tyria & non-expansion releases" catch-all, looks up its wiki
   article's *first-ever revision timestamp* as an approximate "date added
   to the game" (one request per title - MediaWiki won't let you batch
   `rvdir=newer` lookups across multiple titles in one call).
5. **`reportEras.mjs`** maps that date onto `TIMELINE` (the same releases,
   in true chronological order, each with its real launch date) to say
   "this skin's wiki page appeared during the X era" for skins the wiki
   never directly tagged with a release category.

## Accuracy & caveats

- **Only ~17% of all 10,612 skins are matched to a specific expansion/LW
  season.** This is expected, not a bug: the wardrobe is dominated by skins
  that were never part of an expansion's story content at all - Gem Store
  releases, crafted/dungeon/fractal/raid-vendor sets, PvP/WvW reward tracks,
  seasonal festivals (Wintersday, Halloween, Lunar New Year), etc. The wiki
  doesn't tag those with a release category, so they land in the
  **"Core Tyria & non-expansion releases"** catch-all bucket along with true
  launch-day (2012 Prophecies) skins. If you need Gem Store vs. launch vs.
  dungeon/PvP/WvW separated out further, that's a natural follow-up (the
  wiki has `Category:Gem Store armor sets` etc. that could be crawled the
  same way) but wasn't in scope here.
- Matching is by **exact skin name**, so a wiki article renamed/retitled
  differently from the live API name won't match (rare, but happens for a
  few skins with punctuation differences).
- **Living World Season 2** currently shows 0 matched skins. Verified this
  isn't a crawler bug: `Category:Living World Season 2 content` does exist
  and has ~360 pages, but they're all non-skin articles (NPCs, achievements,
  lore books, map decorations) - none of S2's `content` pages are skins, and
  the wiki never built a `Living World Season 2 armor/weapon sets` category
  the way it did for S3/S4. If S2 wardrobe attribution matters to you, it'll
  need manual/alternate sourcing.
- Sets released mid-expansion via a Living World episode (e.g. Requiem
  armor, added in LW S4 while Path of Fire was the current expansion) are
  bucketed under the **expansion**, matching how the wiki itself groups
  `armor sets`/`weapon sets` categories - not under the LW season, even
  though the article is also tagged with both.
- `via` in the output tells you the confidence: `set` / `set-direct` (high)
  vs `content` (lower - double-check anything that matters).

### Inferred "era" for non-expansion skins (`reportEras.mjs`)

For the 8,834 skins the wiki doesn't tag with any release category, there's
no expansion to report - most of them (Gem Store, crafting, dungeons, PvP/WvW,
festivals) genuinely weren't added *by* an expansion. What we can still say
is *when* each one showed up, by using the wiki article's first-revision
date and slotting it into whichever release was "current" at that time:

- **7,801 of 8,834** got a date this way; **1,033** have no matching wiki
  page at all (name mismatch, or the article was never written) and are
  reported as `unknown`.
- This is a **proxy, not ground truth**. A wiki page is usually created
  within days of an item's real release, but can lag by a lot for obscure
  items nobody documented promptly, or lead it slightly for datamined
  pre-release content. Treat single-skin lookups as reliable-ish; treat
  the aggregate era counts as directionally correct.
- The result deliberately says "era" (e.g. "released during the Icebrood
  Saga era"), not "added by Icebrood Saga" - a Gem Store skin sold in that
  window wasn't added by the expansion, it just shipped while it was current.
- Current era breakdown (`out/unmatched-by-era.md`):

  | Era | Skins |
  |---|---:|
  | Core Tyria & non-expansion releases (pre-LWS1) | 1,804 |
  | Living World Season 1 | 861 |
  | Living World Season 2 | 754 |
  | Heart of Thorns | 635 |
  | Living World Season 3 | 41 |
  | Path of Fire | 227 |
  | Living World Season 4 | 651 |
  | The Icebrood Saga | 821 |
  | End of Dragons | 765 |
  | Secrets of the Obscure | 497 |
  | Janthir Wilds | 452 |
  | Visions of Eternity | 293 |
  | unknown (no wiki page found) | 1,033 |

## Output

- `data/skins-by-expansion.json` - full structured data, one entry per
  release bucket with `{label, count, skins: [{id, name, type, rarity, via, set}]}`.
- `data/unmatched-release-dates.json` - `{ skinName: { missing, timestamp } }`
  wiki first-revision lookups for the non-expansion bucket.
- `out/summary.csv` - flat `id,name,type,rarity,weight_class,bucket,via,set` for spreadsheets.
- `out/counts.md` - quick count table (also printed to console on `npm run build`).
- `data/skins-by-window.json` / `web/data.js` - all skins merged into the 7
  release windows + "unknown" bucket the web page reads (`buildWebData.mjs`).
- `out/unmatched-by-era.csv` / `out/unmatched-by-era.md` - the non-expansion
  bucket only, with `wiki_first_seen` date and `inferred_era` per skin.
