import { jsonError, readJson, requireProfile } from "@/lib/server/apiAuth";
import { db } from "@/lib/server/supabase";
import type { Insert } from "@/lib/server/database.types";
import type { Penalty } from "@/lib/types";

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
 */

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
}

/** A whole local history is 2000 solves; a batch is a slice of one. */
const MAX_BATCH = 500;

const PENALTIES = new Set<Penalty>(["OK", "PLUS2", "DNF"]);
const SOURCES = new Set(["keyboard", "smartcube", "manual"]);

export async function POST(request: Request) {
  const auth = await requireProfile();
  if (!auth.ok) return auth.response;

  const body = await readJson<{ solves?: unknown }>(request);
  if (!body || !Array.isArray(body.solves)) {
    return jsonError("Malformed request.", 400);
  }
  if (body.solves.length > MAX_BATCH) {
    return jsonError(`Send at most ${MAX_BATCH} solves at a time.`, 413);
  }

  const rows: Insert<"solves">[] = [];

  for (const raw of body.solves as IncomingSolve[]) {
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

    const solvedAt =
      typeof at === "number" && Number.isFinite(at) && at > 0 ? at : Date.now();

    rows.push({
      profile_id: auth.profile.id,
      client_id: id,
      event: "333",
      scramble,
      duration_ms: Math.round(durationMs),
      penalty,
      move_count:
        typeof moveCount === "number" && Number.isFinite(moveCount)
          ? Math.round(moveCount)
          : 0,
      tps: typeof tps === "number" && Number.isFinite(tps) ? tps : 0,
      source,
      mode: "practice",
      // Never true on this route. See the note at the top of the file.
      verified: false,
      splits: (Array.isArray(raw.splits) ? raw.splits : []) as never,
      oll_case: typeof raw.ollCase === "string" ? raw.ollCase : null,
      pll_case: typeof raw.pllCase === "string" ? raw.pllCase : null,
      solved_at: new Date(solvedAt).toISOString(),
    });
  }

  if (rows.length === 0) {
    return Response.json({ stored: 0, skipped: body.solves.length });
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

  if (error) return jsonError("Could not save those solves.", 500);

  return Response.json({
    stored: count ?? 0,
    skipped: body.solves.length - rows.length,
  });
}
