/**
 * Pre-generates a small pool of scrambles that ships in the client bundle.
 *
 * The random-state scramble generator is a ~600KB WASM chunk. Waiting for it
 * before showing anything means no scramble on screen for over a second on 4G,
 * which is the whole app being unusable. These are real random-state scrambles
 * produced by the same generator, just ahead of time — equally WCA-legal — so the
 * first scramble can be on screen the moment the app hydrates while WASM loads
 * behind it and takes over from the second scramble onward.
 *
 * Deliberately a separate file from `dailies.json`: the dailies must stay
 * server-only, or tomorrow's daily scramble would be readable straight out of the
 * JS bundle and could be practised in advance.
 *
 *   node scripts/generate-pool.mjs [count]
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const EVENT = "333";
const DEFAULT_COUNT = 200;

const here = dirname(fileURLToPath(import.meta.url));
const outPath = join(here, "..", "src", "data", "scramble-pool.json");
const count = Number(process.argv[2] ?? DEFAULT_COUNT);

const realLog = console.log;
console.log = () => {};
const { randomScrambleForEvent } = await import("cubing/scramble");
console.log = realLog;

const scrambles = [];
for (let i = 0; i < count; i++) {
  console.log = () => {};
  const alg = await randomScrambleForEvent(EVENT);
  console.log = realLog;
  scrambles.push(alg.toString());
  if ((i + 1) % 50 === 0) process.stdout.write(`  ${i + 1}/${count}\n`);
}

const unique = new Set(scrambles);
if (unique.size !== scrambles.length) {
  console.error(`Expected ${scrambles.length} unique scrambles, got ${unique.size}`);
  process.exit(1);
}

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify({ event: EVENT, scrambles })}\n`);
console.log(`\nWrote ${count} pooled ${EVENT} scrambles to src/data/scramble-pool.json`);
process.exit(0);
