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

export interface TableHeader {
  version: number;
  entries: { key: string; kind: "Int32Array" | "Uint8Array"; length: number }[];
}
