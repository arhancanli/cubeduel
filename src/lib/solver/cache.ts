/**
 * Where the precomputed tables live, and what shape the file is.
 *
 * Shared between the generator and the loader so the two cannot disagree about
 * the format — which matters more than usual here, because a misread pruning
 * table does not fail loudly. The search treats those values as admissible lower
 * bounds on the distance to a solution; feed it wrong ones and it prunes away
 * branches containing the answer, then reports a longer solution or none at all,
 * with nothing anywhere saying why.
 */

/** Relative to the repository root. Generated, never committed. */
export const TABLE_CACHE_PATH = ".solver-cache/tables.bin.gz";

/**
 * Bumped whenever the meaning of the bytes changes.
 *
 * The loader refuses a file whose version it does not recognise, and whose
 * declared table lengths do not match what this build expects, and falls back to
 * computing them. Slower is an acceptable failure; wrong is not.
 */
export const TABLE_FORMAT_VERSION = 1;

/**
 * The exact phase-one table, in a file of its own.
 *
 * Separate because it is a different size of thing — 67MB against 11MB, and
 * where the tables above are needed by anything that solves at all, this one is
 * an optimisation. A caller that has not generated it still solves, a little
 * slower, on the pair tables. One file for both would make that all-or-nothing.
 */
export const PHASE1_CACHE_PATH = ".solver-cache/phase1.bin.gz";

export const PHASE1_FORMAT_VERSION = 1;

export type TableKind = "Int32Array" | "Uint16Array" | "Uint8Array";

export interface TableHeader {
  version: number;
  entries: { key: string; kind: TableKind; length: number }[];
}

/** Bytes per element, by kind — the one place the two sides agree on it. */
export const BYTES_PER_ELEMENT: Record<TableKind, number> = {
  Int32Array: 4,
  Uint16Array: 2,
  Uint8Array: 1,
};
