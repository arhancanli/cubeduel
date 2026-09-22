import { jsonError, readJson, requireProfile } from "@/lib/server/apiAuth";
import { createChallenge, createOpenChallenge } from "@/lib/server/challenges";

/**
 * Challenges another player by handle.
 *
 * The response deliberately does not include the scramble. The challenger chose
 * an opponent, not a scramble — handing it over here would let them study it and
 * then pick their moment, which is the whole thing the feature is built to avoid.
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = await requireProfile("ranked");
  if (!auth.ok) return auth.response;

  const body = (await readJson<{ handle?: unknown; open?: unknown }>(request)) ?? {};

  // Two shapes, one row: a handle names an opponent, `open: true` leaves the
  // seat empty for whoever turns up. Anything else is a typo, and a typo that
  // quietly created an open challenge would be a challenge sent to nobody.
  const open = body.open === true;
  if (!open && (typeof body.handle !== "string" || body.handle.length > 40)) {
    return jsonError("Pick somebody to challenge, or leave it open to anybody.", 400);
  }

  const result = open
    ? await createOpenChallenge(auth.profile.id)
    : await createChallenge(auth.profile.id, (body.handle as string).trim());
  if (!result.ok) return jsonError(result.reason, 400);

  return Response.json(result);
}
