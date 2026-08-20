import { jsonError, readJson } from "@/lib/server/authRoutes";
import { completePasswordReset } from "@/lib/server/emailTokens";
import { isDatabaseConfigured } from "@/lib/server/supabase";

/**
 * Setting a new password from a link.
 *
 * POST, never GET. Mail clients and link scanners prefetch URLs, and a password
 * change on a GET would be performed by a machine before the person ever saw
 * the page.
 *
 * The reset itself signs every device out — including whoever may have taken
 * the account, which is the point of the flow rather than housekeeping.
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isDatabaseConfigured()) {
    return jsonError("Password reset is not available right now.", 503);
  }

  const body = await readJson<{ token?: unknown; password?: unknown }>(request);
  if (!body || typeof body.token !== "string" || typeof body.password !== "string") {
    return jsonError("Malformed request.", 400);
  }

  const result = await completePasswordReset(body.token, body.password);
  if (result.ok) return Response.json({ ok: true });

  // The three failures are told apart because the person is holding the link
  // already — saying it has expired reveals nothing they could not find out by
  // using it, and "invalid" for an expired link sends somebody hunting for a
  // problem that is not there.
  const message =
    result.reason === "weak"
      ? result.error
      : result.reason === "used"
        ? "That link has already been used. Ask for a new one."
        : result.reason === "expired"
          ? "That link has expired. Ask for a new one."
          : "That link is not valid. Ask for a new one.";

  return jsonError(message, 400);
}
