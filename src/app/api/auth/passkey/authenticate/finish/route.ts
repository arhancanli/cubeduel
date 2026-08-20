import {
  callerIp,
  callerUserAgent,
  jsonError,
  readJson,
  recordAttempt,
  tooManyAttempts,
} from "@/lib/server/authRoutes";
import { setSessionCookie } from "@/lib/server/currentUser";
import { finishAuthentication } from "@/lib/server/passkeys";
import { createSession } from "@/lib/server/sessions";
import { isDatabaseConfigured } from "@/lib/server/supabase";

/**
 * Verifies a passkey assertion and starts a session.
 *
 * The verification and the session are deliberately separate steps in separate
 * modules: `finishAuthentication` stops at "these bytes prove the holder of
 * this credential was present", and this decides what that entitles them to.
 */
export const dynamic = "force-dynamic";

interface Body {
  challenge?: unknown;
  credentialId?: unknown;
  authenticatorData?: unknown;
  clientDataJSON?: unknown;
  signature?: unknown;
  userHandle?: unknown;
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

  const body = await readJson<Body>(request);
  if (!body || typeof body.challenge !== "string") return jsonError("Malformed request.", 400);

  const credentialId = decode(body.credentialId);
  const authenticatorData = decode(body.authenticatorData);
  const clientDataJSON = decode(body.clientDataJSON);
  const signature = decode(body.signature);
  if (!credentialId || !authenticatorData || !clientDataJSON || !signature) {
    return jsonError("Malformed request.", 400);
  }

  const ip = await callerIp();

  // Counted without an address, because there is not one to count: a
  // discoverable sign-in never says who it is until the credential is matched.
  // The per-origin limit is the only one that applies here.
  if (await tooManyAttempts(null, ip)) {
    return jsonError("Too many attempts. Wait a few minutes.", 429);
  }

  const result = await finishAuthentication({
    challenge: body.challenge,
    credentialId,
    authenticatorData,
    clientDataJSON,
    signature,
    userHandle: decode(body.userHandle) ?? null,
  });

  await recordAttempt(null, ip, result.ok);
  if (!result.ok) return jsonError(result.error, 401);

  const session = await createSession(result.userId, {
    userAgent: await callerUserAgent(),
    ip,
  });
  if (!session) return jsonError("Could not start a session. Try again.", 500);

  await setSessionCookie(session.token);

  // Surfaced rather than acted on, exactly like the humanness score. A counter
  // that went backwards means two authenticators are presenting one credential,
  // which is worth telling somebody about and is not grounds for locking them
  // out of an account they have just proven they control.
  return Response.json({ ok: true, clonedWarning: result.clonedWarning });
}
