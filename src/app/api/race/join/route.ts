import { jsonError, readJson, requireProfile } from "@/lib/server/apiAuth";
import { joinRace } from "@/lib/server/races";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = await requireProfile("race");
  if (!auth.ok) return auth.response;
  const body = await readJson<{ code?: unknown }>(request);
  if (typeof body?.code !== "string") return jsonError("Malformed request.", 400);
  const result = await joinRace(auth.profile.id, body.code);
  return result.ok ? Response.json(result) : jsonError(result.reason, 409);
}
