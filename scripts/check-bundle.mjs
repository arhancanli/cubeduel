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
 *
 * 3. Server-only crypto must NOT reach the client bundle. `auth/password.ts`
 *    imports `node:crypto` and `node:util`; a client component importing even a
 *    single constant from it pulls the whole module in, `promisify` throws
 *    `The "original" argument must be of type Function` on load, and the page
 *    that imported it renders NOTHING.
 *
 *    That is not hypothetical — it shipped. `ResetScreen` imported
 *    `MIN_PASSWORD_LENGTH` from it, and `/reset` had no form on it at all: the
 *    one page somebody reaches when they have already lost access to their
 *    account. TypeScript was happy, the server render was correct, and only
 *    opening the page in a browser showed it. The policy now lives in
 *    `auth/passwordPolicy.ts`, which imports nothing.
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

/**
 * Refuse to check output older than the code.
 *
 * Without this, a failed build leaves the previous bundle in place and every
 * check below passes — against files that do not correspond to the source
 * anybody is about to ship. That is a guard which cannot fail, which is worse
 * than no guard because it is believed.
 *
 * Found the honest way: a deliberate regression made the build fail, and this
 * script cheerfully reported "checks passed" on the stale output from the run
 * before it.
 */
function newestMtime(dir) {
  let newest = 0;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stats = statSync(full);
    newest = Math.max(newest, stats.isDirectory() ? newestMtime(full) : stats.mtimeMs);
  }
  return newest;
}

const newestSource = newestMtime(join(root, "src"));
const newestBundle = newestMtime(staticDir);
if (newestBundle < newestSource) {
  console.error(
    "Build output is older than src/. The last build either failed or never ran,\n" +
      "so these checks would be examining code nobody is shipping. Run `npm run build`.",
  );
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

// The stored-hash prefix is unique to `password.ts` and appears nowhere else, so
// finding it in a client chunk means the crypto module was bundled. Checked as a
// string rather than by walking imports: this asks what actually shipped.
const CRYPTO_MARKERS = ["scrypt$", "SCRYPT_N"];
const leakedCrypto = CRYPTO_MARKERS.filter((marker) => bundles.includes(marker));
if (leakedCrypto.length > 0) {
  failures.push(
    `Server-only crypto reached the client bundle (found ${leakedCrypto.join(", ")}). ` +
      "A client component is importing src/lib/auth/password.ts — import from " +
      "auth/passwordPolicy.ts instead, or the page will crash on load.",
  );
}

if (failures.length > 0) {
  console.error("Bundle checks FAILED:\n");
  for (const f of failures) console.error(` - ${f}`);
  process.exit(1);
}

console.log(
  `Bundle checks passed (probed ${probes.length} future dailies, pool present, no server crypto).`,
);
