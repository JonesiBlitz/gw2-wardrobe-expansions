// Copies web/ -> docs/, since GitHub Pages' "deploy from branch" mode can
// only serve the repo root or a /docs folder, not an arbitrary directory.
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.join(__dirname, "..", "web");
const DOCS = path.join(__dirname, "..", "docs");

async function main() {
  await rm(DOCS, { recursive: true, force: true });
  await mkdir(DOCS, { recursive: true });
  await cp(WEB, DOCS, { recursive: true });
  await writeFile(path.join(DOCS, ".nojekyll"), ""); // GitHub Pages: skip Jekyll processing
  console.log(`Copied ${WEB} -> ${DOCS}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
