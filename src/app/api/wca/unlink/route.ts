import { jsonError } from "@/lib/server/authRoutes";
import { currentProfile } from "@/lib/server/profiles";
import { isDatabaseConfigured } from "@/lib/server/supabase";
import { unlinkWca } from "@/lib/server/wca";

/**
 * Removing a WCA link.
 *
 * Unconditional and immediate. Somebody who no longer wants their competition
 * results shown here should not have to argue with a confirmation dialog, and
 * nothing is lost that cannot be proved again in thirty seconds.
 */
export const dynamic = "force-dynamic";

export async function POST() {
  if (!isDatabaseConfigured()) return jsonError("Not available right now.", 503);

  const profile = await currentProfile();
  if (!profile) return jsonError("Sign in first.", 401);

  const removed = await unlinkWca(profile.id);
  if (!removed) return jsonError("Could not unlink. Try again.", 500);
  return Response.json({ ok: true });
}
