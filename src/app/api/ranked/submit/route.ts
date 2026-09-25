import { jsonError, readJson, requireProfile } from "@/lib/server/apiAuth";
import { submitAttempt } from "@/lib/server/ranked";
import type { Penalty } from "@/lib/types";
import { parseMoves } from "@/lib/moveInput";

/**
 * Submits a solved ranked attempt for verification.
 *
 * Everything here is treated as hostile input. The route's job is to get it into
 * a shape the verifier can reason about and then get out of the way — the actual
 * decision belongs in `verifySolve`, where it is unit-tested, rather than in an
 * HTTP handler where it is not.
 */

interface Body {
  attemptId?: unknown;
  clientId?: unknown;
  durationMs?: unknown;
  penalty?: unknown;
  source?: unknown;
  moves?: unknown;
  splits?: unknown;
  ollCase?: unknown;
  pllCase?: unknown;
}

const PENALTIES = new Set<Penalty>(["OK", "PLUS2", "DNF"]);

export async function POST(request: Request) {
  const auth = await requireProfile();
  if (!auth.ok) return auth.response;

  const body = await readJson<Body>(request);
  if (!body) return jsonError("Malformed request.", 400);

  const { attemptId, clientId, durationMs, penalty, source } = body;

  if (typeof attemptId !== "string" || attemptId.length > 64) {
    return jsonError("Missing attempt.", 400);
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

  // A declared DNF carries no move stream, and demanding one would make it
  // impossible to report the failure the rating rules depend on.
  const moves = penalty === "DNF" ? [] : parseMoves(body.moves);
  if (moves === null) return jsonError("Malformed move stream.", 400);

  try {
    const result = await submitAttempt({
      profileId: auth.profile.id,
      attemptId,
      clientId,
      moves,
      durationMs,
      penalty: penalty as Penalty,
      splits: body.splits,
      ollCase: typeof body.ollCase === "string" ? body.ollCase : null,
      pllCase: typeof body.pllCase === "string" ? body.pllCase : null,
      source,
    });

    // A rejected solve is a normal outcome, not a server fault: the player gets
    // told why, and the attempt is spent.
    return Response.json(result, { status: result.accepted ? 200 : 422 });
  } catch {
    return jsonError("Could not record that solve.", 500);
  }
}
