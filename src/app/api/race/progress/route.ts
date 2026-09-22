import { jsonError, readJson, requireProfile } from "@/lib/server/apiAuth";
import { reportProgress } from "@/lib/server/races";

/**
 * How far through the solve a player is, for the other screen. Display only —
 * bounded on the way in and never used to decide anything.
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = await requireProfile("race");
  if (!auth.ok) return auth.response;
  const body = await readJson<{ code?: unknown; progress?: unknown }>(request);
  if (typeof body?.code !== "string") return jsonError("Malformed request.", 400);
  const ok = await reportProgress(auth.profile.id, body.code, body.progress);
  return ok ? Response.json({ ok }) : jsonError("Progress not recorded.", 409);
}
