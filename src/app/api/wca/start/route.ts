import { redirect } from "next/navigation";

import { jsonError } from "@/lib/server/authRoutes";
import { ensureProfile } from "@/lib/server/profiles";
import { isDatabaseConfigured } from "@/lib/server/supabase";
import { beginWcaLink, wcaConfigured } from "@/lib/server/wca";

/**
 * Sends somebody to the WCA to prove who they are.
 *
 * A GET that redirects, because it is reached from a link rather than a form —
 * and nothing is changed by starting a flow that may well be abandoned. The
 * state row it creates expires in ten minutes on its own.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  if (!isDatabaseConfigured() || !wcaConfigured()) {
    return jsonError("WCA linking is not configured on this deployment.", 503);
  }

  const profile = await ensureProfile();
  if (!profile) return jsonError("Sign in first.", 401);

  const destination = await beginWcaLink(profile.id);
  if (!destination) return jsonError("Could not start that. Try again.", 500);

  redirect(destination);
}
