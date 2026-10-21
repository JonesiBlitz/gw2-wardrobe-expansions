# gw2-wardrobe-expansions

Buckets every GW2 wardrobe skin (armor, weapon, back item, gathering tool),
mini and novelty by the expansion / living-world release that introduced it,
and ships a browsable web page over the result.

**Live:** <https://jonesiblitz.github.io/gw2-wardrobe-expansions/>

## Browse it

Live, at the link above (served from `docs/`, rebuilt by `npm run build:docs`
whenever `web/` changes), or locally:

```bash
npm run serve
```

then open <http://localhost:5175>. Tabs are "release windows" spanning one
expansion gap each (Core Tyria &rarr; Heart of Thorns, Heart of Thorns &rarr;
Path of Fire, ...), with search, a type filter (Armor/Weapon/Back/Gathering/
Mini/Novelty), and a confidence filter. Each card links out to the item's GW2
Wiki page.
Needs `npm run all` to have been run first so `web/data.js` (and `docs/`)
exist.

### Filtering by your own unlocked skins

Click **Settings** to add a GW2 API key (create one at
[account.arena.net/applications](https://account.arena.net/applications)
with only the **unlocks** permission checked). Once saved, the page calls
`/v2/account/skins` directly from your browser and unlocks an "All skins /
Unlocked only / Locked only" filter, with a lock/unlock badge on every card.

- The key is stored **only** in your browser's `localStorage` and sent
  **only** to `api.guildwars2.com` (via `?access_token=`, not a header -
  the GW2 API doesn't send CORS headers for authenticated requests, so a
  query param is what avoids the preflight browser block). This site has
  no server or database of its own, so there is nowhere else for it to go.
- It re-syncs automatically on every page load if a key is saved; use
  **Refresh wardrobe** in Settings to re-sync on demand, or **Remove key**
  to delete it from `localStorage` immediately.
- Matching is by skin **id** (not name), so it's exact - no ambiguity from
  the weight-class ("Angler Vest") issue described below.
- The same key also syncs `/v2/account/minis` and `/v2/account/novelties`
  (same **unlocks** permission), used by the festival tabs below.

### Festival tabs

A second tab row lists each festival - Lunar New Year, Super Adventure Box,
Dragon Bash, Festival of the Four Winds, Halloween and Wintersday -
with its skins, minis and novelties and the same unlocked/locked filter. These
span every year, so a festival skin also appears in its release-window tab.

`src/fetchFestivals.mjs` builds each one from five sources:

1. The festival's category tree on the wiki (`Category:Wintersday`, `Gem Store
   Wintersday items`, ...), crawled to depth 3.
2. The festival's `<Festival>/items` index page: the skins, minis and novelties
   linked from its weapon, armor, mini and tonic sections, plus every full
   weapon set it lists (e.g. Halloween's Candy Core / Unchained sets, Dragon
   Bash's Sacred Crystal set), whose members come from `Category:<set>`.
   The `<Festival>/items` page lags new releases, so each festival's per-year
   pages ("Shadow of the Mad King 2026", "A Very Merry Wintersday 2025", ...) are
   also read: anything in their "New skins and equipment / miniatures / items"
   sections is added, and a weapon set listed only there is accepted only if its
   own page says "Festival weapons" (those pages also link WvW/sPvP sets such
   as Obsidian). That is how this year's Fog Machine weapons were found.
3. The festival's vendors: the "Vendors" section of its page plus an
   `extraVendors` list in `FESTIVALS` for merchants that section doesn't link,
   found by diffing against the wiki's `Category:Festival Merchants` (e.g. the
   Super Adventure Box Trader, Weaponsmith and Weekly Trader, the Four Winds
   Bazaar merchants, Court Merchant, Lunatic Chef, Fortune Scrap Vendor).
   Their item tables give cost and weekly limits, both for single items and
   for the "Trader's ... Chest (choice)" style chests that hold a whole set.
   Vendors whose title ends "(historical)" are tagged "past festival vendor"
   instead of a current source.

4. The official achievements API:
   - *Rewards:* festival achievement categories are picked by name (they sit in
     the Historical / Daily / Bonus Events groups; there is no "festival"
     group). Item rewards are resolved to skins (via the item's default skin, or
     for skin-unlock consumables such as "... Backpack Cover" by name), minis
     (`minipet_id`) and novelties (their unlock item) and tagged "Achievement
     reward". Reward *containers* (chests, gift boxes) can't be opened via the
     API, so their contents still come from the wiki set pages.
   - *Collections:* every achievement in the Rare / Black Lion / Basic /
     Festival Collections categories is read - its skin, mini and item pieces
     plus what it awards. A collection joins a festival when it is in the
     "Festival Collections" category and named for that festival (Mad Armory,
     Tricks and Treats, Lunatic Court's Finery, Royal Flame Weapons, the
     Wintersday and Super Adventure Box ones, ...), or when that festival's tab
     already holds at least half of its pieces. Tagged "Collection
     achievement" (tooltip names the collection). Most Festival Collections
     pieces are food, essences, ornaments and novels rather than wardrobe
     items, so those collections mainly contribute their reward.
5. Black Lion weapon sets released with a festival: the wiki's "<Set> weapon
   skins" pages say "introduced for Shadow of the Mad King 2016" (or Wintersday,
   Dragon Bash, ...) and name the "<Set> Weapon Collection" they award, e.g.
   Gargoyle, Mad Realm, Seven Reapers (Halloween), Frostforged, Glacial,
   Orchestral (Wintersday), Maguuma (Dragon Bash), Alchemist (Lunar New Year),
   Inquest Mark II (Super Adventure Box). They are tagged "Black Lion set"
   plus their collection; they are not festival-vendor items.

Everything else is matched by name to the API's skins, minis and novelties
(novelties also by their unlock item's name), so it is best-effort: anything
the wiki doesn't link from those sources won't show up. Super Adventure Box
has no `/items` page, so its weapon sets are taken from its
`Category:<Set> weapons` categories instead. April Fools' Vendor is in
`Category:Festival Merchants` but sells Fool's tonics and cat armor boxes, not
festival content, so it is left out.

Weapons, minis and novelties also get an **acquisition** tag and a filter
listing only the sources present in the tab: festival vendor (tooltip shows
vendor, cost and limit), achievement chest, past achievement chest (chest the
set page marks "discontinued"), prize bag, Trick-or-Treat bag, Courtly Weapon
Chest, Mystic Forge, Mad Armory collection, creature drop. Halloween also reads
each weapon's own wiki page for the last four. Set weapons whose wiki item name
has a stat prefix ("Giver's Candy Cane Axe") are mapped to the unprefixed skin.

Notes: the 12 Halloween Sparking Stone weapons are also in the random Courtly
Weapon Chest, so the vendor is only their *guaranteed* source. The wiki lists
a Grim Machine Spear but `/v2/skins` has no skin by that name, so it isn't shown.

## Why this needs two data sources

The official GW2 API's [`/v2/skins`](https://wiki.guildwars2.com/wiki/API:2/skins)
endpoint has no "expansion" or "release" field at all. The
[GW2 Wiki](https://wiki.guildwars2.com), however, tags articles with
categories like `Category:Path of Fire content` and groups skins into
per-release "set" categories like `Category:Path of Fire armor sets`. This
project crawls those wiki categories and joins the result back onto the
official API data by skin name.

### Minis and novelties in the release windows

All 951 minis and 236 novelties in the API (the unreleased "((208738))"-style
placeholder entries are skipped) are placed in the same release windows as
skins, dated the same two ways: the item's wiki page is tagged "<Expansion>
content" (the "expansion content" badge) or, failing that, its page's first
revision date is slotted into the release that was current (the "wiki: date"
badge). Novelties are looked up by their own name, then by their unlock
item's name. `src/fetchMiniNoveltyDates.mjs` does this; ~97% got a window and
the rest stay in "Unknown / undated". The same caveat as skins applies: a wiki
page's creation date is a proxy, not an official release date. They also keep
appearing on their festival tab where they belong to one.

## Pipeline

Re-run `npm run all` after a game update (new skins, a new festival year, ...).
The wiki date lookups are cached - a page's first revision never changes - so
a refresh only fetches new names; the festival and wiki crawls re-run in full.

```bash
npm run fetch:skins   # -> data/skins.json                    (GW2 API: all 10k+ skins)
npm run fetch:wiki    # -> data/wiki-title-map.json            (GW2 Wiki: title -> release)
npm run build         # -> data/skins-by-expansion.json, out/summary.csv, out/counts.md
npm run fetch:dates              # -> data/unmatched-release-dates.json      (GW2 Wiki: title -> first-seen date)
npm run fetch:dates:weightclass  # -> data/weight-class-release-dates.json   (retry via "<name> (light/medium/heavy skin)")
npm run report:eras              # -> out/unmatched-by-era.csv, out/unmatched-by-era.md
npm run fetch:festivals          # -> data/festivals.json                    (festival tabs, see below)
npm run fetch:minis              # -> data/minis-novelties.json              (release window for every mini/novelty)
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
5. **`fetchWeightClassDates.mjs`** - retries every skin step 4 came up empty
   on. A lot of armor skin *names* are reused across weight classes (e.g.
   "Angler Vest" is a separate Light/Medium/Heavy skin, each with its own
   release), so the wiki disambiguates them as `<Name> (light skin)` /
   `(medium skin)` / `(heavy skin)`, and the plain name often isn't a real
   article at all - it's exactly why step 4 reported so many as "no wiki
   page found". This alone recovered dates for ~770 skins (see
   `src/skinTitle.mjs`).
6. **`reportEras.mjs`** maps the resolved date (weight-class title preferred,
   plain-name title as fallback - `resolveSkinDate()` in `skinTitle.mjs`)
   onto `TIMELINE` (the same releases, in true chronological order, each
   with its real launch date) to say "this skin's wiki page appeared during
   the X era" for skins the wiki never directly tagged with a release
   category.

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

- **8,572 of 8,834** got a date this way; only **262** have no matching wiki
  page at all (name mismatch, or the article was never written) and are
  reported as `unknown`. (Before the weight-class retry in step 5, this was
  7,801 dated / 1,033 unknown - the disambiguated-title lookup alone closed
  most of that gap.)
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
  | Living World Season 1 | 885 |
  | Living World Season 2 | 823 |
  | Heart of Thorns | 647 |
  | Living World Season 3 | 44 |
  | Path of Fire | 227 |
  | Living World Season 4 | 654 |
  | The Icebrood Saga | 920 |
  | End of Dragons | 912 |
  | Secrets of the Obscure | 605 |
  | Janthir Wilds | 602 |
  | Visions of Eternity | 449 |
  | unknown (no wiki page found) | 262 |

## Output

- `data/skins-by-expansion.json` - full structured data, one entry per
  release bucket with `{label, count, skins: [{id, name, type, rarity, via, set}]}`.
- `data/unmatched-release-dates.json` - `{ skinName: { missing, timestamp } }`
  wiki first-revision lookups for the non-expansion bucket (plain title).
- `data/weight-class-release-dates.json` - same shape, keyed by the
  weight-class-disambiguated title (`"<Name> (light skin)"` etc.), for
  armor skins the plain-title lookup missed.
- `out/summary.csv` - flat `id,name,type,rarity,weight_class,bucket,via,set` for spreadsheets.
- `out/counts.md` - quick count table (also printed to console on `npm run build`).
- `data/skins-by-window.json` / `web/data.js` - all skins merged into the 7
  release windows + "unknown" bucket the web page reads (`buildWebData.mjs`).
- `out/unmatched-by-era.csv` / `out/unmatched-by-era.md` - the non-expansion
  bucket only, with `wiki_first_seen` date and `inferred_era` per skin.
