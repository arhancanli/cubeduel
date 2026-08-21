/**
 * Removes rows that can no longer do anything.
 *
 *   npm run sweep
 *
 * Works with no configuration, which is the point: the Vercel cron at
 * `/api/maintenance/sweep` is an automation of this, not the only way to run
 * it. See `src/lib/server/maintenance.ts` for why that ordering matters.
 */
import { sweepAll } from "../src/lib/server/maintenance";

const removed = await sweepAll();

const total = Object.values(removed).reduce((sum, n) => sum + n, 0);
console.log(`Removed ${total} row(s):`);
for (const [table, count] of Object.entries(removed)) {
  console.log(`  ${table.padEnd(14)} ${count}`);
}
console.log(
  "\nNothing here is load-bearing — every rule is enforced on read as well, so" +
    "\na table that was not swept is bigger, not wrong.",
);
process.exit(0);
