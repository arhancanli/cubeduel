/**
 * Precomputes the solver's lookup tables into a file.
 *
 *   npm run tables:build      (runs automatically before `npm run build`)
 *
 * The tables are 11.5MB of move tables and pruning tables, and generating them
 * takes 1.2-2.7 seconds. That cost lands on the first request a cold serverless
 * instance serves, and it was the whole reason `/api/solve` measured 2.07s cold
 * against 0.46s warm — the search itself is 68ms.
 *
 * Written out and gzipped, they are 3.66MB on disk and take **30ms** to load
 * and rebuild the typed-array views: forty times faster than computing them,
 * and byte-identical, which the round-trip check below asserts rather than
 * assumes.
 *
 * Deliberately generated at build time and never committed. A checked-in binary
 * would go stale the moment anybody edited the coordinate or table code, and a
 * stale *pruning* table is not a slow solver — it is a wrong one, because the
 * search trusts those numbers as admissible lower bounds and will prune away
 * the real solution. Regenerating from the current source every build makes
 * that impossible.
 */
import { gzipSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { buildTables } from "../src/lib/solver";
import {
  PHASE1_CACHE_PATH,
  PHASE1_FORMAT_VERSION,
  TABLE_CACHE_PATH,
  TABLE_FORMAT_VERSION,
  type TableHeader,
} from "../src/lib/solver/cache";
import { MOVE_COUNT } from "../src/lib/solver/tables";
import {
  PHASE1_TABLE_SIZE,
  buildPhase1Distances,
  buildPhase1Symmetry,
} from "../src/lib/solver/phase1Table";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "..", TABLE_CACHE_PATH);

/** Header, lengths and bytes, in the shape both the writer and loader expect. */
function pack(version: number, views: [string, ArrayBufferView][]): Buffer {
  const header: TableHeader = {
    version,
    entries: views.map(([key, view]) => ({
      key,
      kind:
        view instanceof Int32Array
          ? "Int32Array"
          : view instanceof Uint16Array
            ? "Uint16Array"
            : "Uint8Array",
      length: (view as unknown as { length: number }).length,
    })),
  };

  const headerJson = Buffer.from(JSON.stringify(header), "utf8");
  const prefix = Buffer.alloc(4);
  prefix.writeUInt32LE(headerJson.length, 0);
  const body = Buffer.concat(
    views.map(([, v]) => Buffer.from(v.buffer, v.byteOffset, v.byteLength)),
  );
  return Buffer.concat([prefix, headerJson, body]);
}

console.log("Building solver tables…");
const started = Date.now();
const tables = buildTables();
console.log(`  computed in ${Date.now() - started}ms`);

const views = Object.entries(tables).filter(([, v]) => ArrayBuffer.isView(v)) as [
  string,
  ArrayBufferView,
][];

const raw = pack(TABLE_FORMAT_VERSION, views);
const packed = gzipSync(raw, { level: 6 });

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, packed);

console.log(`  ${(raw.length / 1024 / 1024).toFixed(2)}MB raw -> ${(packed.length / 1024 / 1024).toFixed(2)}MB gzipped`);
console.log(`  wrote ${TABLE_CACHE_PATH}`);

// ---------------------------------------------------------------------------
// The exact phase-one table.
//
// 141 million entries — how many moves every phase-one position needs, not a
// bound — packed two to a byte. It is the difference between a phase one that
// explores 773 million nodes to solve sixty cubes and one that explores a small
// fraction of that; see `phase1Table.ts` and section 8 of docs/solver.md.
// ---------------------------------------------------------------------------
console.log("\nBuilding the exact phase-one table…");
const phase1Started = Date.now();

const symmetry = buildPhase1Symmetry();
console.log(`  ${(Date.now() - phase1Started)}ms for the symmetry classes`);

const fillStarted = Date.now();
const distances = buildPhase1Distances(
  {
    twistMove: tables.twistMove,
    flipMove: tables.flipMove,
    sliceMove: tables.sliceMove,
    moveCount: MOVE_COUNT,
  },
  symmetry,
  (depth, filled) => {
    const percent = ((100 * filled) / PHASE1_TABLE_SIZE).toFixed(1);
    if (filled >= PHASE1_TABLE_SIZE || depth >= 9) {
      console.log(`    depth ${depth}: ${percent}% filled`);
    }
  },
);
console.log(`  filled in ${((Date.now() - fillStarted) / 1000).toFixed(1)}s`);

const phase1Raw = pack(PHASE1_FORMAT_VERSION, [
  ["classIndex", symmetry.classIndex],
  ["classSym", symmetry.classSym],
  ["twistConj", symmetry.twistConj],
  ["distances", distances],
]);
// Level 1: this file is 67MB of nibbles and is read far more often than it is
// written. Level 6 spends about half a minute to save a tenth of the bytes.
const phase1Packed = gzipSync(phase1Raw, { level: 1 });

writeFileSync(join(here, "..", PHASE1_CACHE_PATH), phase1Packed);
console.log(
  `  ${(phase1Raw.length / 1024 / 1024).toFixed(1)}MB raw -> ${(phase1Packed.length / 1024 / 1024).toFixed(1)}MB gzipped`,
);
console.log(`  wrote ${PHASE1_CACHE_PATH}`);
process.exit(0);
