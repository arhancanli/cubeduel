/**
 * Guards two build invariants. Run after `npm run build`.
 *
 * 1. Future daily scrambles must NOT reach the client bundle. `dailies.json` holds
 *    every scramble for over a year; it is imported only from the server component
 *    at `src/app/daily/page.tsx`, which forwards a single day. If someone ever
 *    imports it from a client component, tomorrow's daily becomes readable in
 *    devtools and can be practised in advance — the daily stops being a contest and
 *    nothing about the UI would look wrong.
 *
 * 2. The startup scramble pool MUST reach the client bundle. It is what puts a
 *    scramble on screen at hydration instead of after the ~600KB WASM generator
 *    lands. If it silently stops being bundled, the app still works and only gets
 *    quietly slower, which is exactly the kind of regression nobody notices.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const staticDir = join(root, ".next", "static");

function readAllBundles(dir) {
  let text = "";
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) text += readAllBundles(full);
    else if (entry.endsWith(".js")) text += readFileSync(full, "utf8");
  }
  return text;
}

let bundles;
try {
  bundles = readAllBundles(staticDir);
} catch {
  console.error("No build output found. Run `npm run build` first.");
  process.exit(1);
}

const dailies = JSON.parse(readFileSync(join(root, "src/data/dailies.json"), "utf8"));
const pool = JSON.parse(readFileSync(join(root, "src/data/scramble-pool.json"), "utf8"));

const failures = [];

// Probe several days spread across the range rather than just one.
const dayKeys = Object.keys(dailies.scrambles);
const probes = [10, 50, 100, 200, 399]
  .filter((i) => i < dayKeys.length)
  .map((i) => ({ day: dayKeys[i], scramble: dailies.scrambles[dayKeys[i]] }));

const leaked = probes.filter((p) => bundles.includes(p.scramble));
if (leaked.length > 0) {
  failures.push(
    `Future daily scrambles are in the client bundle (${leaked
      .map((l) => l.day)
      .join(", ")}). Something imports dailies.json from a client component.`,
  );
}

if (!bundles.includes(pool.scrambles[0])) {
  failures.push(
    "The startup scramble pool is missing from the client bundle — the first scramble will block on the WASM generator.",
  );
}

if (failures.length > 0) {
  console.error("Bundle checks FAILED:\n");
  for (const f of failures) console.error(` - ${f}`);
  process.exit(1);
}

console.log(`Bundle checks passed (probed ${probes.length} future dailies, pool present).`);
