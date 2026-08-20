import { clearSessionCookie, currentSessionToken } from "@/lib/server/currentUser";
import { revokeSession } from "@/lib/server/sessions";

/**
 * Signing out.
 *
 * Both halves, always: the row is deleted AND the cookie is cleared. Clearing
 * the cookie alone leaves a token that still authenticates anybody who kept a
 * copy; deleting the row alone leaves the browser presenting a dead cookie on
 * every request.
 *
 * POST rather than GET, so that an image tag on another site cannot sign
 * somebody out. It is a small harm and an entirely free one to prevent.
 */
export const dynamic = "force-dynamic";

export async function POST() {
  const token = await currentSessionToken();
  if (token) await revokeSession(token);
  await clearSessionCookie();
  return Response.json({ ok: true });
}
