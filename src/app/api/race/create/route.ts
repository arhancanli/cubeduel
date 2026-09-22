import { jsonError, readJson, requireProfile } from "@/lib/server/apiAuth";
import { createRace } from "@/lib/server/races";

/** Opens a race and seats the creator. The link it returns is the invitation. */
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = await requireProfile("race");
  if (!auth.ok) return auth.response;
  const body = await readJson<{ event?: unknown }>(request);
  const result = await createRace(auth.profile.id, typeof body?.event === "string" ? body.event : "333");
  return result.ok ? Response.json(result) : jsonError(result.reason, 409);
}
