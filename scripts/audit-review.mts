/**
 * The solve review's accuracy, at scale. See `src/lib/reviewAudit.ts`.
 *
 *     npm run audit:review -- [count] [seed]
 */
import { auditReview } from "../src/lib/reviewAudit";

const count = Number(process.argv[2] ?? 400);
const seed = Number(process.argv[3] ?? 1);
const a = await auditReview(count, seed);
const pct = (x: number, of: number) => `${((100 * x) / of).toFixed(1)}% (${x}/${of})`;
console.log(`solves: ${a.solves}`);
console.log(`phases in the right order: ${pct(a.phasesInOrder, a.solves)}`);
console.log(`phase ends read to the move: ${pct(a.boundariesRight, a.boundaries)}`);
console.log(`OLL case: ${pct(a.ollRight, a.solves)}`);
console.log(`PLL case: ${pct(a.pllRight, a.solves)}`);
if (a.misreads.length) console.log("first misreads:\n  " + a.misreads.join("\n  "));
