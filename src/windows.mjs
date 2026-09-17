// Coarser "release windows" for the browsing UI - one tab per expansion gap,
// each bundling the expansion plus whatever Living World seasons/sagas ran
// before the next expansion launched (e.g. "Core Tyria -> Heart of Thorns"
// includes LW Season 1 and 2).
import { TIMELINE } from "./expansions.mjs";

export const WINDOWS = [
  { key: "core-to-hot", label: "Core Tyria → Heart of Thorns", from: "2012-08-28", to: "2015-10-23", eraKeys: ["core-tyria", "living-world-s1", "living-world-s2"] },
  { key: "hot-to-pof", label: "Heart of Thorns → Path of Fire", from: "2015-10-23", to: "2017-09-22", eraKeys: ["heart-of-thorns", "living-world-s3"] },
  { key: "pof-to-eod", label: "Path of Fire → End of Dragons", from: "2017-09-22", to: "2022-02-28", eraKeys: ["path-of-fire", "living-world-s4", "icebrood-saga"] },
  { key: "eod-to-soto", label: "End of Dragons → Secrets of the Obscure", from: "2022-02-28", to: "2023-08-22", eraKeys: ["end-of-dragons"] },
  { key: "soto-to-jw", label: "Secrets of the Obscure → Janthir Wilds", from: "2023-08-22", to: "2024-08-20", eraKeys: ["secrets-of-the-obscure"] },
  { key: "jw-to-voe", label: "Janthir Wilds → Visions of Eternity", from: "2024-08-20", to: "2025-10-28", eraKeys: ["janthir-wilds"] },
  { key: "voe-onward", label: "Visions of Eternity → present", from: "2025-10-28", to: null, eraKeys: ["visions-of-eternity"] },
];

export const UNKNOWN_WINDOW = { key: "unknown", label: "Unknown / undated", from: null, to: null, eraKeys: [] };

const eraKeyToWindowKey = new Map();
for (const w of WINDOWS) for (const ek of w.eraKeys) eraKeyToWindowKey.set(ek, w.key);

export function windowKeyForEraKey(eraKey) {
  return eraKeyToWindowKey.get(eraKey) ?? UNKNOWN_WINDOW.key;
}

// Given an ISO date, returns the TIMELINE entry ("era") that was current then.
export function eraForDate(isoDate) {
  const t = new Date(isoDate).getTime();
  let match = TIMELINE[0];
  for (const bucket of TIMELINE) {
    if (!bucket.released) continue;
    if (new Date(bucket.released).getTime() <= t) match = bucket;
    else break;
  }
  return match;
}
