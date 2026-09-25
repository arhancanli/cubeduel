import { jsonError, requireProfile } from "@/lib/server/apiAuth";
import { issueWeeklyAttempt } from "@/lib/server/weekly";

/**
 * Opens your next attempt of this week's five, and only then says what its
 * scramble is. Opening one closes any you left open as a DNF.
 */
export const dynamic = "force-dynamic";

export async function POST() {
  const auth = await requireProfile("weekly");
  if (!auth.ok) return auth.response;
  try {
    const result = await issueWeeklyAttempt(auth.profile.id, "keyboard");
    if (!result.ok) return jsonError(result.error, result.status);
    const { attemptId, idx, scramble, expiresAt } = result;
    return Response.json({ attemptId, idx, scramble, expiresAt });
  } catch {
    return jsonError("Could not open that attempt.", 500);
  }
}
