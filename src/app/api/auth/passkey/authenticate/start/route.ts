import { jsonError } from "@/lib/server/authRoutes";
import { beginAuthentication } from "@/lib/server/passkeys";
import { isDatabaseConfigured } from "@/lib/server/supabase";

/**
 * Asks for the options needed to sign in with a passkey.
 *
 * Takes no body at all, and that is the interesting part. It does not want an
 * address, because wanting one would mean looking up which passkeys that
 * address has and answering "is this person registered here?" to anybody who
 * asks. Registration requests discoverable credentials precisely so this can be
 * anonymous: the authenticator already knows what it holds for this site.
 */
export const dynamic = "force-dynamic";

export async function POST() {
  if (!isDatabaseConfigured()) return jsonError("Passkeys are not available right now.", 503);

  const options = await beginAuthentication();
  if (!options) return jsonError("Could not start that. Try again in a minute.", 429);

  return Response.json(options);
}
