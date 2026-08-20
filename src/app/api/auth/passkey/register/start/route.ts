import { jsonError } from "@/lib/server/authRoutes";
import { currentSession } from "@/lib/server/currentUser";
import { beginRegistration } from "@/lib/server/passkeys";
import { isDatabaseConfigured } from "@/lib/server/supabase";

/**
 * Asks for the options needed to create a passkey.
 *
 * Requires a session, because a passkey belongs to an account. The claim flow
 * therefore creates the account first and adds the passkey second — which is
 * also why sign-up does not demand a password.
 */
export const dynamic = "force-dynamic";

export async function POST() {
  if (!isDatabaseConfigured()) return jsonError("Passkeys are not available right now.", 503);

  const session = await currentSession();
  if (!session) return jsonError("Sign in first.", 401);

  const options = await beginRegistration({
    id: session.user.id,
    email: session.user.email,
    displayName: session.user.email.split("@")[0] ?? "Cuber",
  });

  // Null here is the rate limit or a database failure, and the two are not
  // distinguished on purpose — neither is something the browser can act on
  // differently.
  if (!options) return jsonError("Could not start that. Try again in a minute.", 429);

  return Response.json(options);
}
