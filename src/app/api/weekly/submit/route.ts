import { parseMoves } from "@/lib/moveInput";
import { jsonError, readJson, requireProfile } from "@/lib/server/apiAuth";
import { submitWeeklyAttempt } from "@/lib/server/weekly";
import type { Penalty } from "@/lib/types";

/**
 * A finished weekly attempt, verified exactly as ranked verifies one. A
 * rejected solve is a normal outcome — the attempt is spent as a DNF and the
 * player is told why — so it is a 422, not a server fault.
 */
export const dynamic = "force-dynamic";

const PENALTIES = new Set<Penalty>(["OK", "PLUS2", "DNF"]);

export async function POST(request: Request) {
  const auth = await requireProfile("weekly");
  if (!auth.ok) return auth.response;

  const body = await readJson<{
    attemptId?: unknown;
    clientId?: unknown;
    durationMs?: unknown;
    penalty?: unknown;
    source?: unknown;
    moves?: unknown;
  }>(request);
  if (!body) return jsonError("Malformed request.", 400);
  const { attemptId, clientId, durationMs, penalty, source } = body;

  if (typeof attemptId !== "string" || attemptId.length > 64) return jsonError("Missing attempt.", 400);
  if (typeof clientId !== "string" || clientId.length > 64) return jsonError("Missing solve id.", 400);
  if (typeof durationMs !== "number" || !Number.isFinite(durationMs) || durationMs < 0) return jsonError("Missing duration.", 400);
  if (typeof penalty !== "string" || !PENALTIES.has(penalty as Penalty)) return jsonError("Unknown penalty.", 400);
  if (source !== "keyboard" && source !== "smartcube") return jsonError("Unknown solve source.", 400);

  // A declared DNF carries no move stream.
  const moves = penalty === "DNF" ? [] : parseMoves(body.moves);
  if (moves === null) return jsonError("Malformed move stream.", 400);

  try {
    const result = await submitWeeklyAttempt({
      profileId: auth.profile.id,
      attemptId,
      clientId,
      moves,
      durationMs,
      penalty: penalty as Penalty,
      source,
    });
    return Response.json(result, { status: result.accepted ? 200 : 422 });
  } catch {
    return jsonError("Could not record that solve.", 500);
  }
}
