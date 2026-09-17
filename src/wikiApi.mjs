// Thin helper around the GW2 Wiki's MediaWiki API (api.php).
const API = "https://wiki.guildwars2.com/api.php";
const UA = "gw2-wardrobe-expansions-research-script/0.1 (local, non-commercial data mapping)";

async function apiGet(params) {
  const url = new URL(API);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("format", "json");
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

/**
 * Returns all members of a category, optionally filtered by cmtype
 * ("page", "subcat", "file", or comma-separated combo). Handles continuation.
 */
export async function getCategoryMembers(categoryTitle, { cmtype = "page|subcat" } = {}) {
  const members = [];
  let cmcontinue;
  do {
    const params = {
      action: "query",
      list: "categorymembers",
      cmtitle: categoryTitle.startsWith("Category:") ? categoryTitle : `Category:${categoryTitle}`,
      cmlimit: "500",
      cmtype,
    };
    if (cmcontinue) params.cmcontinue = cmcontinue;
    const json = await apiGet(params);
    const batch = json?.query?.categorymembers ?? [];
    members.push(...batch);
    cmcontinue = json?.continue?.cmcontinue;
  } while (cmcontinue);
  return members;
}

/**
 * For a list of article titles, returns a Map from title to
 * { missing: false, timestamp } (ISO timestamp of that page's first ever
 * revision - a proxy for "when this was added to the game") or
 * { missing: true } if no such wiki page exists.
 *
 * Note: MediaWiki's `rvlimit`/`rvdir=newer` combo (needed to get the FIRST
 * revision instead of the latest) only works for a single page per query
 * ("invalidparammix" otherwise), so this issues one request per title,
 * `concurrency` at a time, with basic retry on transient failures.
 */
export async function getFirstRevisionTimestamps(titles, { concurrency = 8, onProgress } = {}) {
  const result = new Map();
  let idx = 0;
  let done = 0;

  async function fetchOne(title) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const json = await apiGet({
          action: "query",
          titles: title,
          prop: "revisions",
          rvlimit: "1",
          rvdir: "newer",
          rvprop: "timestamp",
          redirects: "1",
        });
        const page = Object.values(json?.query?.pages ?? {})[0];
        if (!page || page.missing !== undefined) return { missing: true };
        return { missing: false, timestamp: page.revisions?.[0]?.timestamp ?? null };
      } catch (err) {
        if (attempt === 2) return { missing: true, error: String(err) };
        await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
      }
    }
  }

  async function worker() {
    while (idx < titles.length) {
      const title = titles[idx++];
      result.set(title, await fetchOne(title));
      done++;
      if (onProgress) onProgress(done, titles.length);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));
  return result;
}
