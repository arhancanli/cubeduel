import { jsonError, readJson, requireProfile } from "@/lib/server/apiAuth";
import { setReady } from "@/lib/server/races";

/** Marks a seat ready; the second ready starts the countdown. */
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = await requireProfile("race");
  if (!auth.ok) return auth.response;
  const body = await readJson<{ code?: unknown; ready?: unknown }>(request);
  if (typeof body?.code !== "string" || typeof body.ready !== "boolean") {
    return jsonError("Malformed request.", 400);
  }
  const result = await setReady(auth.profile.id, body.code, body.ready);
  return result.ok ? Response.json(result) : jsonError(result.reason, 409);
}
