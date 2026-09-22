import { jsonError } from "@/lib/server/apiAuth";
import { ensureProfile } from "@/lib/server/profiles";
import { raceView } from "@/lib/server/races";
import { isDatabaseConfigured } from "@/lib/server/supabase";

/**
 * Everything the viewer may know about a race, polled by both screens.
 *
 * Signed-out viewers may watch: a race link can be opened by anybody, and seeing
 * who is racing is the prompt to sign in and take the empty seat. The scramble is
 * still withheld from everybody until the start (see `scrambleVisible`).
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isDatabaseConfigured()) return jsonError("Racing is not available right now.", 503);
  const code = new URL(request.url).searchParams.get("code") ?? "";
  const viewer = await ensureProfile().catch(() => null);
  const view = await raceView(code, viewer?.id ?? null);
  if (!view) return jsonError("No such race.", 404);
  return Response.json(view, { headers: { "cache-control": "no-store" } });
}
