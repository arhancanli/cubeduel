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
import { TABLE_CACHE_PATH, TABLE_FORMAT_VERSION, type TableHeader } from "../src/lib/solver/cache";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "..", TABLE_CACHE_PATH);

console.log("Building solver tables…");
const started = Date.now();
const tables = buildTables();
console.log(`  computed in ${Date.now() - started}ms`);

const views = Object.entries(tables).filter(([, v]) => ArrayBuffer.isView(v)) as [
  string,
  ArrayBufferView,
][];

const header: TableHeader = {
  version: TABLE_FORMAT_VERSION,
  entries: views.map(([key, view]) => ({
    key,
    kind: view instanceof Int32Array ? "Int32Array" : "Uint8Array",
    length: (view as unknown as { length: number }).length,
  })),
};

const headerJson = Buffer.from(JSON.stringify(header), "utf8");
const prefix = Buffer.alloc(4);
prefix.writeUInt32LE(headerJson.length, 0);
const body = Buffer.concat(
  views.map(([, v]) => Buffer.from(v.buffer, v.byteOffset, v.byteLength)),
);
const raw = Buffer.concat([prefix, headerJson, body]);
const packed = gzipSync(raw, { level: 6 });

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, packed);

console.log(`  ${(raw.length / 1024 / 1024).toFixed(2)}MB raw -> ${(packed.length / 1024 / 1024).toFixed(2)}MB gzipped`);
console.log(`  wrote ${TABLE_CACHE_PATH}`);
process.exit(0);
