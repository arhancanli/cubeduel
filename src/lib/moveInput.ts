import { MAX_MOVES, type SubmittedMove } from "./verifySolve";

/**
 * A submitted move stream, read as hostile input: an array of at most
 * `MAX_MOVES` `{ move, atMs }`, each move a short string — it is headed for a
 * regex and then an algorithm parser — and each time a finite number. Anything
 * else is null, and the route answers 400.
 */
export function parseMoves(value: unknown): SubmittedMove[] | null {
  if (!Array.isArray(value) || value.length > MAX_MOVES) return null;
  const moves: SubmittedMove[] = [];
  for (const raw of value) {
    if (typeof raw !== "object" || raw === null) return null;
    const { move, atMs } = raw as { move?: unknown; atMs?: unknown };
    if (typeof move !== "string" || move.length > 8) return null;
    if (typeof atMs !== "number" || !Number.isFinite(atMs)) return null;
    moves.push({ move, atMs });
  }
  return moves;
}
