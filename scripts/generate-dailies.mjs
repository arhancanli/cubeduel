/**
 * Pre-generates the daily scramble for every date in a fixed window.
 *
 * The daily has to be byte-identical for every player, and random-state
 * generation is by definition not reproducible from a seed. Generating the whole
 * window once and committing the result gives a shared puzzle with no server,
 * no database, and no way for the scramble to differ between two people.
 *
 * Dates are UTC. One global round, one global reset, one leaderboard.
 *
 *   node scripts/generate-dailies.mjs [startDate] [days]
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const EVENT = "333";
const DEFAULT_START = "2026-08-11";
const DEFAULT_DAYS = 400;

const here = dirname(fileURLToPath(import.meta.url));
const outPath = join(here, "..", "src", "data", "dailies.json");

const startDate = process.argv[2] ?? DEFAULT_START;
const days = Number(process.argv[3] ?? DEFAULT_DAYS);

if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
  console.error(`Bad start date: ${startDate} (expected YYYY-MM-DD)`);
  process.exit(1);
}

// cubing.js reports generation timings on stdout; silence them so the progress
// output stays readable.
const realLog = console.log;
console.log = () => {};
const { randomScrambleForEvent } = await import("cubing/scramble");
console.log = realLog;

function utcDateKey(base, offsetDays) {
  const d = new Date(`${base}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

const dailies = {};
const started = Date.now();

for (let i = 0; i < days; i++) {
  const key = utcDateKey(startDate, i);
  console.log = () => {};
  const alg = await randomScrambleForEvent(EVENT);
  console.log = realLog;
  dailies[key] = alg.toString();

  if ((i + 1) % 50 === 0 || i === days - 1) {
    process.stdout.write(`  ${i + 1}/${days} generated\n`);
  }
}

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(
  outPath,
  `${JSON.stringify({ event: EVENT, start: startDate, days, scrambles: dailies }, null, 0)}\n`,
);

const seconds = ((Date.now() - started) / 1000).toFixed(1);
console.log(`\nWrote ${days} daily scrambles for ${EVENT} to src/data/dailies.json in ${seconds}s`);
console.log(`Range: ${utcDateKey(startDate, 0)} -> ${utcDateKey(startDate, days - 1)} (UTC)`);
process.exit(0);
