"use client";

/**
 * The browser half of the passkey ceremonies.
 *
 * Its whole job is translation. `navigator.credentials` speaks `ArrayBuffer`
 * and the server speaks JSON, and the gap between them is where this quietly
 * goes wrong: an `ArrayBuffer` serialises through `JSON.stringify` to `{}`.
 * Not an error, not a warning — an empty object. Send one of those and the
 * server sees a missing field and refuses, and the symptom is "passkeys just
 * don't work" with nothing in any console to say why.
 *
 * So every buffer crossing the wire goes through `toBase64Url` here and
 * `Buffer.from(value, "base64url")` on the other side, and neither end ever
 * touches a raw buffer in a JSON body.
 */

function toBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  // Chunked because `String.fromCharCode(...bytes)` spreads every byte into an
  // argument list, and a large credential blows the call stack. It works for
  // small keys and fails for big ones, which is the worst possible split.
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): ArrayBuffer {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, "="));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/** Whether this browser can do passkeys at all. */
export function passkeysSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.PublicKeyCredential === "function" &&
    typeof navigator.credentials?.create === "function"
  );
}

export type PasskeyResult =
  | { ok: true }
  | { ok: false; error: string; cancelled: boolean };

/**
 * Turns whatever the browser threw into something worth showing.
 *
 * `NotAllowedError` covers both "the person pressed cancel" and "the prompt
 * timed out", and it is by far the most common outcome — people open the sheet
 * and think better of it. Showing a red error for that is wrong: nothing failed
 * and nothing is broken, so it is reported as cancelled and the caller stays
 * quiet.
 */
function describe(cause: unknown): PasskeyResult {
  if (cause instanceof DOMException) {
    if (cause.name === "NotAllowedError") {
      return { ok: false, cancelled: true, error: "Cancelled." };
    }
    if (cause.name === "InvalidStateError") {
      return {
        ok: false,
        cancelled: false,
        error: "This device already has a passkey for cubeduel.",
      };
    }
    if (cause.name === "SecurityError") {
      return {
        ok: false,
        cancelled: false,
        error: "Passkeys need a secure connection.",
      };
    }
  }
  return { ok: false, cancelled: false, error: "That didn't work. Try again." };
}

/** Creates a passkey for the signed-in account. */
export async function createPasskey(label?: string): Promise<PasskeyResult> {
  if (!passkeysSupported()) {
    return { ok: false, cancelled: false, error: "This browser doesn't support passkeys." };
  }

  const optionsResponse = await fetch("/api/auth/passkey/register/start", { method: "POST" });
  if (!optionsResponse.ok) {
    const body = (await optionsResponse.json().catch(() => null)) as { error?: string } | null;
    return { ok: false, cancelled: false, error: body?.error ?? "Could not start that." };
  }
  const options = await optionsResponse.json();

  let credential: PublicKeyCredential | null;
  try {
    credential = (await navigator.credentials.create({
      publicKey: {
        ...options,
        challenge: fromBase64Url(options.challenge),
        user: { ...options.user, id: fromBase64Url(options.user.id) },
        excludeCredentials: (options.excludeCredentials ?? []).map(
          (entry: { id: string; type: string; transports?: string[] }) => ({
            ...entry,
            id: fromBase64Url(entry.id),
          }),
        ),
      },
    })) as PublicKeyCredential | null;
  } catch (cause) {
    return describe(cause);
  }

  if (!credential) return { ok: false, cancelled: true, error: "Cancelled." };

  const response = credential.response as AuthenticatorAttestationResponse;
  const finish = await fetch("/api/auth/passkey/register/finish", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      challenge: options.challenge,
      attestationObject: toBase64Url(response.attestationObject),
      clientDataJSON: toBase64Url(response.clientDataJSON),
      transports: response.getTransports?.() ?? [],
      label,
    }),
  });

  if (!finish.ok) {
    const body = (await finish.json().catch(() => null)) as { error?: string } | null;
    return { ok: false, cancelled: false, error: body?.error ?? "Could not save that passkey." };
  }
  return { ok: true };
}

/**
 * Signs in with a passkey, with nothing typed.
 *
 * No address is sent and none is asked for. The authenticator already knows
 * what it holds for this site, because registration asked for a discoverable
 * credential — which is both the better experience and the more private one.
 */
export async function signInWithPasskey(): Promise<PasskeyResult> {
  if (!passkeysSupported()) {
    return { ok: false, cancelled: false, error: "This browser doesn't support passkeys." };
  }

  const optionsResponse = await fetch("/api/auth/passkey/authenticate/start", { method: "POST" });
  if (!optionsResponse.ok) {
    const body = (await optionsResponse.json().catch(() => null)) as { error?: string } | null;
    return { ok: false, cancelled: false, error: body?.error ?? "Could not start that." };
  }
  const options = await optionsResponse.json();

  let credential: PublicKeyCredential | null;
  try {
    credential = (await navigator.credentials.get({
      publicKey: {
        challenge: fromBase64Url(options.challenge),
        rpId: options.rpId,
        timeout: options.timeout,
        userVerification: options.userVerification,
        allowCredentials: [],
      },
    })) as PublicKeyCredential | null;
  } catch (cause) {
    return describe(cause);
  }

  if (!credential) return { ok: false, cancelled: true, error: "Cancelled." };

  const response = credential.response as AuthenticatorAssertionResponse;
  const finish = await fetch("/api/auth/passkey/authenticate/finish", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      challenge: options.challenge,
      credentialId: toBase64Url(credential.rawId),
      authenticatorData: toBase64Url(response.authenticatorData),
      clientDataJSON: toBase64Url(response.clientDataJSON),
      signature: toBase64Url(response.signature),
      userHandle: response.userHandle ? toBase64Url(response.userHandle) : undefined,
    }),
  });

  if (!finish.ok) {
    const body = (await finish.json().catch(() => null)) as { error?: string } | null;
    return { ok: false, cancelled: false, error: body?.error ?? "That passkey wasn't recognised." };
  }
  return { ok: true };
}
