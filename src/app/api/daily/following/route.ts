import dailies from "@/data/dailies.json";
import { todayNumber } from "@/lib/daily";
import { jsonError, requireProfile } from "@/lib/server/apiAuth";
import { followingCount, followingDaily } from "@/lib/server/follows";

/**
 * Today's daily for you and the people you follow. Read after posting your own
 * result, to see where you landed among the people you measure yourself by.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireProfile("follow");
  if (!auth.ok) return auth.response;
  try {
    const [results, following] = await Promise.all([
      followingDaily(auth.profile.id, todayNumber(dailies.start)),
      followingCount(auth.profile.id),
    ]);
    return Response.json({ results, following });
  } catch {
    return jsonError("Could not load today's results.", 500);
  }
}
