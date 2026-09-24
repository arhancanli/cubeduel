import "server-only";

import { decodeMoveStream, isRotation } from "../moveStream";
import { sanitizeSplits } from "../splits";
import { parseSyncedEvent } from "../events";
import type { Penalty } from "../types";
import { MAX_MOVES, MAX_PLAUSIBLE_TPS } from "../verifySolve";
import type { Insert } from "./database.types";
import { analysisFromStream } from "./solveAnalysis";
import { db } from "./supabase";

/**
 * Uploads locally-recorded solves so history follows a player between devices.
 *
 * Two things this route is careful not to be:
 *
 * **It is not a rating path.** Everything arriving here was scrambled by the
 * client, so nothing can be verified and every row is stored with
 * `verified: false` and `mode: 'practice'`. It is a backup of your own practice
 * log, not evidence. Letting local solves feed the ladder would make the ladder
 * meaningless, since the client would be choosing both the puzzle and the time.
 *
 * **It is not destructive.** Uploads are idempotent on `(profile_id, client_id)`,
 * so syncing the same history twice — two devices, a retry, a refresh — inserts
 * each solve once and never overwrites a stored row with a re-sent one.
 *
 * **It keeps the turns.** Practice solves used to arrive as a time and a list of
 * phase totals, so the move stream — the one thing this site records that a
 * stopwatch cannot — was thrown away on the most common kind of solve, and its
 * public page then said it had been "entered by hand". The stream now travels
 * with the solve, and three kinds of solve are stored three ways:
 *
 *   - **With a stream that holds up**, the breakdown, cases, move count and turn
 *     rate are all worked out here from the stream. Nothing the request says
 *     about them is used.
 *   - **With a stream that does not** — unreadable, longer than the clock, faster
 *     than a human turns, or over this request's replay budget — the stream is
 *     dropped AND so is everything derived from it: no breakdown, no cases, no
 *     count. The request's own splits came from that same stream.
 *   - **With no stream at all** — a stopwatch time, or a solve recorded before
 *     streams were kept — there is nothing to derive from. Its hand-marked laps
 *     or recorded splits are kept after validation, which is all anybody could
 *     know about it. That is the one place a request's own numbers are stored,
 *     and they are never verified: nothing on this route ever is.
 */

/**
 * How many moves one request may ask to be replayed. Analysis costs a little
 * over a tenth of a millisecond per move (6.6ms for a 57-move solve, measured),
 * so this caps a request near three and a half seconds of work. An honest client
 * sends 100 solves of about 60 moves — a fifth of it. Without a cap, a single
 * request of 250 long streams padded with rotations could hold a function for
 * minutes.
 */
const REPLAY_BUDGET_MOVES = 30_000;

/** Last-layer case ids as `lastLayer.ts` writes them. */
const CASE_ID = /^\d{4}\|\d{4}$/;

interface IncomingSolve {
  id?: unknown;
  at?: unknown;
  scramble?: unknown;
  durationMs?: unknown;
  penalty?: unknown;
  moveCount?: unknown;
  tps?: unknown;
  splits?: unknown;
  ollCase?: unknown;
  pllCase?: unknown;
  source?: unknown;
  /** Which puzzle; absent from clients older than the multi-puzzle timer. */
  event?: unknown;
  /** `encodeMoveStream` output. */
  moves?: unknown;
}

const PENALTIES = new Set<Penalty>(["OK", "PLUS2", "DNF"]);
const SOURCES = new Set(["keyboard", "smartcube", "manual"]);

export interface SyncResult {
  stored: number;
  skipped: number;
}

/**
 * Stores a batch of practice solves for one profile.
 *
 * Separate from the route so it can be exercised against a real database
 * without a browser session in front of it — the same reason `profileStore.ts`
 * exists. The route checks who is asking; this decides what gets written.
 */
export async function storePracticeSolves(
  profileId: string,
  solves: readonly unknown[],
): Promise<SyncResult> {
  const rows: Insert<"solves">[] = [];
  let replayed = 0;

  for (const raw of solves as IncomingSolve[]) {
    if (typeof raw !== "object" || raw === null) continue;

    const {
      id,
      at,
      scramble,
      durationMs,
      penalty,
      moveCount,
      tps,
      source,
    } = raw;

    // Anything malformed is skipped rather than failing the batch. A single bad
    // record in a year of history must not block the other 1999 from syncing.
    if (typeof id !== "string" || id.length === 0 || id.length > 64) continue;
    if (typeof scramble !== "string" || scramble.length > 512) continue;
    if (typeof durationMs !== "number" || !Number.isFinite(durationMs)) continue;
    if (durationMs < 0 || durationMs > 86_400_000) continue;
    if (typeof penalty !== "string" || !PENALTIES.has(penalty as Penalty)) continue;
    if (typeof source !== "string" || !SOURCES.has(source)) continue;
    const event = parseSyncedEvent(raw.event);
    if (event === null) continue;

    const solvedAt =
      typeof at === "number" && Number.isFinite(at) && at > 0 ? at : Date.now();

    // A stream is kept only if it is one this app could have written AND it fits
    // the solve it came with: no longer than the verifier accepts, its last turn
    // no later than the clock stopped (a small allowance covers the recorder
    // rounding each time to the millisecond), no faster than a human turns, and
    // within what this request may ask to have replayed.
    const sentStream = typeof raw.moves === "string" && raw.moves.trim() !== "";
    const decoded = sentStream ? decodeMoveStream(raw.moves as string) : null;
    const turnCount = decoded ? decoded.filter((m) => !isRotation(m.move)).length : 0;
    const moves =
      decoded &&
      decoded.length > 0 &&
      decoded.length <= MAX_MOVES &&
      source !== "manual" &&
      // Streams are only ever read as a 3x3 solve.
      event === "333" &&
      decoded.at(-1)!.atMs <= durationMs + 5 &&
      durationMs > 0 &&
      turnCount / (durationMs / 1000) <= MAX_PLAUSIBLE_TPS &&
      replayed + decoded.length <= REPLAY_BUDGET_MOVES
        ? decoded
        : null;
    if (moves) replayed += moves.length;

    const refused = sentStream && moves === null;
    const analysis = moves
      ? await analysisFromStream("333", scramble, moves)
      : refused
        ? { splits: [], ollCase: null, pllCase: null }
        : {
            splits: sanitizeSplits(raw.splits),
            ollCase: typeof raw.ollCase === "string" && CASE_ID.test(raw.ollCase) ? raw.ollCase : null,
            pllCase: typeof raw.pllCase === "string" && CASE_ID.test(raw.pllCase) ? raw.pllCase : null,
          };

    // With a stream, the counts are read off it like everything else; with a
    // refused one, there are none.
    const turns = moves ? turnCount : refused ? 0 : null;

    rows.push({
      profile_id: profileId,
      client_id: id,
      event,
      scramble,
      duration_ms: Math.round(durationMs),
      penalty,
      move_count:
        turns ??
        (typeof moveCount === "number" && Number.isFinite(moveCount) && moveCount >= 0 && moveCount <= MAX_MOVES
          ? Math.round(moveCount)
          : 0),
      tps:
        turns !== null
          ? durationMs > 0
            ? turns / (durationMs / 1000)
            : 0
          : typeof tps === "number" && Number.isFinite(tps) && tps >= 0 && tps <= MAX_PLAUSIBLE_TPS
            ? tps
            : 0,
      source,
      mode: "practice",
      // Never true on this route. See the note at the top of the file.
      verified: false,
      moves: moves as never,
      splits: analysis.splits as never,
      oll_case: analysis.ollCase,
      pll_case: analysis.pllCase,
      solved_at: new Date(solvedAt).toISOString(),
    });
  }

  if (rows.length === 0) {
    return { stored: 0, skipped: solves.length };
  }

  // `ignoreDuplicates` is what makes a re-sync a no-op instead of an overwrite:
  // the stored row wins, so a solve whose penalty was edited on the server is
  // not reverted by an older copy still sitting in another device's storage.
  const { error, count } = await db()
    .from("solves")
    .upsert(rows, {
      onConflict: "profile_id,client_id",
      ignoreDuplicates: true,
      count: "exact",
    });

  if (error) throw new Error(`Could not save those solves: ${error.message}`);

  return { stored: count ?? 0, skipped: solves.length - rows.length };
}
