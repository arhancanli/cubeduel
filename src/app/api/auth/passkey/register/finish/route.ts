import { after } from "next/server";

import { jsonError, readJson } from "@/lib/server/authRoutes";
import { currentSession } from "@/lib/server/currentUser";
import { sendPasskeyAddedEmail } from "@/lib/server/email";
import { finishRegistration } from "@/lib/server/passkeys";
import { isDatabaseConfigured } from "@/lib/server/supabase";

/**
 * Stores a newly created passkey.
 *
 * Everything arrives base64url encoded, because `ArrayBuffer` does not survive
 * `JSON.stringify` — it serialises to `{}`, silently, which is a bug that looks
 * like the authenticator returning nothing.
 */
export const dynamic = "force-dynamic";

interface Body {
  challenge?: unknown;
  attestationObject?: unknown;
  clientDataJSON?: unknown;
  transports?: unknown;
  label?: unknown;
}

const decode = (value: unknown): Uint8Array | null => {
  if (typeof value !== "string" || value.length === 0 || value.length > 20_000) return null;
  try {
    return Uint8Array.from(Buffer.from(value, "base64url"));
  } catch {
    return null;
  }
};

export async function POST(request: Request) {
  if (!isDatabaseConfigured()) return jsonError("Passkeys are not available right now.", 503);

  const session = await currentSession();
  if (!session) return jsonError("Sign in first.", 401);

  const body = await readJson<Body>(request);
  if (!body || typeof body.challenge !== "string") return jsonError("Malformed request.", 400);

  const attestationObject = decode(body.attestationObject);
  const clientDataJSON = decode(body.clientDataJSON);
  if (!attestationObject || !clientDataJSON) return jsonError("Malformed request.", 400);

  const transports = Array.isArray(body.transports)
    ? body.transports.filter((t): t is string => typeof t === "string").slice(0, 8)
    : undefined;

  const result = await finishRegistration({
    userId: session.user.id,
    challenge: body.challenge,
    attestationObject,
    clientDataJSON,
    transports,
    label: typeof body.label === "string" ? body.label : undefined,
  });

  if (!result.ok) return jsonError(result.error, 400);

  // A passkey added by somebody else is a permanent way into the account that
  // leaves no other trace — no password changed, no session that looks odd. It
  // is exactly the event that has to be announced out of band.
  after(async () => {
    await sendPasskeyAddedEmail(
      session.user.email,
      typeof body.label === "string" ? body.label : null,
    );
  });

  return Response.json({ ok: true, passkeyId: result.passkeyId });
}
