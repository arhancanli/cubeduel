import { jsonError, readJson, requireProfile } from "@/lib/server/apiAuth";
import { finishDuel } from "@/lib/server/duels";
import type { Penalty } from "@/lib/types";
import { MAX_MOVES, type SubmittedMove } from "@/lib/verifySolve";

/**
 * Submits the player's side of a duel.
 *
 * The solve is verified against the scramble the server issued for this duel,
 * exactly as a ranked solve is. A duel win is worth nothing if the solve behind
 * it was never checked.
 */

const PENALTIES = new Set<Penalty>(["OK", "PLUS2", "DNF"]);

function parseMoves(value: unknown): SubmittedMove[] | null {
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

interface Body {
  duelId?: unknown;
  clientId?: unknown;
  durationMs?: unknown;
  penalty?: unknown;
  source?: unknown;
  moves?: unknown;
  splits?: unknown;
}

export async function POST(request: Request) {
  const auth = await requireProfile("ranked");
  if (!auth.ok) return auth.response;

  const body = await readJson<Body>(request);
  if (!body) return jsonError("Malformed request.", 400);

  const { duelId, clientId, durationMs, penalty, source } = body;
  if (typeof duelId !== "string" || duelId.length > 64) {
    return jsonError("Missing duel.", 400);
  }
  if (typeof clientId !== "string" || clientId.length > 64) {
    return jsonError("Missing solve id.", 400);
  }
  if (typeof durationMs !== "number" || !Number.isFinite(durationMs)) {
    return jsonError("Missing duration.", 400);
  }
  if (typeof penalty !== "string" || !PENALTIES.has(penalty as Penalty)) {
    return jsonError("Unknown penalty.", 400);
  }
  if (source !== "keyboard" && source !== "smartcube") {
    return jsonError("Unknown solve source.", 400);
  }

  const moves = penalty === "DNF" ? [] : parseMoves(body.moves);
  if (moves === null) return jsonError("Malformed move stream.", 400);

  try {
    const result = await finishDuel({
      profileId: auth.profile.id,
      duelId,
      clientId,
      moves,
      durationMs,
      penalty: penalty as Penalty,
      source,
      splits: body.splits,
    });
    // A rejected solve is a normal outcome, not a server fault.
    return Response.json(result, { status: result.accepted ? 200 : 422 });
  } catch {
    return jsonError("Could not record that duel.", 500);
  }
}
