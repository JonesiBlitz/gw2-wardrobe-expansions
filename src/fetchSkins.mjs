// Pulls the full wardrobe skin catalog (armor, weapon, back, gathering) from
// the official GW2 API and writes it to data/skins.json.
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_FILE = path.join(__dirname, "..", "data", "skins.json");
const API = "https://api.guildwars2.com/v2";
const CHUNK_SIZE = 200;

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function main() {
  console.log("Fetching skin id list...");
  const ids = await fetchJson(`${API}/skins`);
  console.log(`Got ${ids.length} skin ids. Fetching details in chunks of ${CHUNK_SIZE}...`);

  const chunks = chunk(ids, CHUNK_SIZE);
  const skins = [];
  for (let i = 0; i < chunks.length; i++) {
    const idsParam = chunks[i].join(",");
    const batch = await fetchJson(`${API}/skins?ids=${idsParam}&lang=en`);
    skins.push(...batch);
    process.stdout.write(`\r  chunk ${i + 1}/${chunks.length} (${skins.length}/${ids.length} skins)`);
  }
  console.log();

  skins.sort((a, b) => a.id - b.id);
  await writeFile(OUT_FILE, JSON.stringify(skins, null, 2));
  console.log(`Wrote ${skins.length} skins to ${OUT_FILE}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
