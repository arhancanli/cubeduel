import "server-only";

import {
  RELYING_PARTY_NAME,
  relyingPartyId,
  relyingPartyOrigin,
} from "../auth/relyingParty";
import {
  bytesForPostgrest,
  bytesFromPostgrest,
  hashTokenForPostgrest,
  newToken,
} from "../auth/tokens";
import {
  WebAuthnError,
  verifyAuthentication,
  verifyRegistration,
  type CeremonyExpectations,
} from "../auth/webauthn";
import { db } from "./supabase";

/**
 * Passkeys, stored.
 *
 * `auth/webauthn.ts` decides whether a ceremony is valid. This decides who is
 * allowed to start one, remembers what was asked, and writes down the result.
 * The split matters because the verification half is pure and exhaustively
 * testable, and this half is where the database races live.
 *
 * ## User verification is required, not preferred
 *
 * A passkey here replaces a password outright, so the authenticator has to
 * confirm the *person* — a face, a fingerprint, a PIN — and not merely that
 * somebody touched it. `userVerification: "required"` is requested at
 * registration and enforced at every sign-in.
 *
 * Both halves have to agree. Registering with "preferred" and then enforcing at
 * sign-in is a way to hand somebody a credential that will never work again,
 * discovered the next time they try to get in.
 *
 * The cost is that a bare security key with no PIN cannot be the only
 * credential on an account. That is the correct trade for something that is the
 * whole of sign-in rather than a second step.
 */

/** How long a ceremony may take. */
const CHALLENGE_TTL_MS = 5 * 60 * 1000;

/**
 * How many ceremonies one account may start in the window.
 *
 * The start endpoint writes a row and is reachable by anybody signed in, so
 * without a cap it is an invitation to fill a table. Ten is far above what an
 * honest person does — a ceremony that fails and is retried a few times is
 * normal, thirty in a minute is not.
 */
const MAX_PENDING_PER_USER = 10;
const RATE_WINDOW_MS = 5 * 60 * 1000;

export interface StoredPasskey {
  id: string;
  label: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  backedUp: boolean | null;
  signCount: number;
}

function expectations(): CeremonyExpectations {
  return {
    // Filled in per ceremony by the caller; this only carries the site-derived
    // half so that no call site has to remember to look them up.
    challenge: "",
    origin: relyingPartyOrigin(),
    rpId: relyingPartyId(),
    requireUserVerification: true,
  };
}

// ---------------------------------------------------------------------------
// Challenges
// ---------------------------------------------------------------------------

/**
 * Issues a challenge and remembers it.
 *
 * Returns the base64url value that goes into the credential options. The row
 * holds only its hash, so this is the one moment the value exists in a form
 * anything can use.
 */
export async function issueChallenge(
  purpose: "register" | "authenticate",
  userId: string | null,
): Promise<string | null> {
  if (userId) {
    const since = new Date(Date.now() - RATE_WINDOW_MS).toISOString();
    const { count, error } = await db()
      .from("webauthn_challenges")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .gte("created_at", since);

    // Checked rather than discarded, and it fails CLOSED. `count ?? 0` on an
    // error would read as "none pending" and turn a database blip into no rate
    // limit at all — the same failing-open bug the outgoing-challenge cap had.
    if (error) return null;
    if ((count ?? 0) >= MAX_PENDING_PER_USER) return null;
  }

  const challenge = newToken();
  const { error } = await db().from("webauthn_challenges").insert({
    challenge_hash: hashTokenForPostgrest(challenge),
    purpose,
    user_id: userId,
    expires_at: new Date(Date.now() + CHALLENGE_TTL_MS).toISOString(),
  });

  if (error) return null;
  return challenge;
}

/**
 * Redeems a challenge exactly once.
 *
 * The delete and the read are one statement — `DELETE ... RETURNING` — so two
 * requests racing the same challenge cannot both find it valid. Reading first
 * and deleting after would leave a window between them, and that window is
 * precisely what a replay needs.
 *
 * Returns the user the challenge was bound to, or `{ userId: null }` for a
 * discoverable sign-in where the server did not yet know who was arriving.
 */
export async function consumeChallenge(
  challenge: string,
  purpose: "register" | "authenticate",
): Promise<{ userId: string | null } | null> {
  if (!challenge) return null;

  const { data, error } = await db()
    .from("webauthn_challenges")
    .delete()
    .eq("challenge_hash", hashTokenForPostgrest(challenge))
    // Part of the match, not checked afterwards: a challenge issued for
    // registration must not be redeemable as a sign-in. Filtering here means a
    // mismatched purpose deletes nothing and finds nothing, rather than
    // consuming the row and then being rejected.
    .eq("purpose", purpose)
    .select("user_id, expires_at")
    .maybeSingle();

  if (error || !data) return null;

  // Expiry is judged here rather than trusted to a sweep. The row is already
  // gone either way, which is right — an expired challenge should not become
  // usable again just because nothing has cleaned it up.
  if (Date.now() >= new Date(data.expires_at).getTime()) return null;

  return { userId: data.user_id };
}

/** Removes challenges that can no longer be redeemed. Safe to call anytime. */
export async function sweepExpiredChallenges(): Promise<number> {
  const { count, error } = await db()
    .from("webauthn_challenges")
    .delete({ count: "exact" })
    .lte("expires_at", new Date().toISOString());
  if (error) return 0;
  return count ?? 0;
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export interface RegistrationOptions {
  challenge: string;
  rp: { id: string; name: string };
  user: { id: string; name: string; displayName: string };
  pubKeyCredParams: { type: "public-key"; alg: number }[];
  authenticatorSelection: {
    residentKey: "required";
    userVerification: "required";
  };
  timeout: number;
  attestation: "none";
  excludeCredentials: { type: "public-key"; id: string; transports?: string[] }[];
}

/**
 * Everything the browser needs to create a passkey for this account.
 *
 * `residentKey: "required"` asks for a *discoverable* credential — one the
 * authenticator can offer without being told which account to look for. That is
 * what makes signing in possible with no email typed at all, which is the whole
 * appeal, and it costs a slot on hardware keys that have a limited number.
 *
 * `excludeCredentials` lists what this account already has, so the authenticator
 * refuses to enrol the same device twice. Without it a person who taps "add a
 * passkey" on a phone they already registered gets a silent duplicate, and then
 * a confusing list of identical-looking entries.
 */
export async function beginRegistration(user: {
  id: string;
  email: string;
  displayName: string;
}): Promise<RegistrationOptions | null> {
  const challenge = await issueChallenge("register", user.id);
  if (!challenge) return null;

  const { data, error } = await db()
    .from("credentials")
    .select("credential_id, transports")
    .eq("user_id", user.id);

  // Not discarded. An error here would produce an empty exclude list, which
  // silently permits the duplicate registration this list exists to prevent.
  if (error) return null;

  return {
    challenge,
    rp: { id: relyingPartyId(), name: RELYING_PARTY_NAME },
    user: {
      // The user handle is opaque bytes that the authenticator stores and hands
      // back on a discoverable sign-in. The spec says explicitly not to put
      // personal information here — it is readable from the authenticator — so
      // it is the account's own id and never the email address.
      id: Buffer.from(user.id.replace(/-/g, ""), "hex").toString("base64url"),
      name: user.email,
      displayName: user.displayName,
    },
    // ES256 first because it is what almost everything produces, then RS256 and
    // Ed25519. The order is a preference, and the list must match what
    // `cose.ts` will actually accept — offering an algorithm the verifier
    // refuses produces a credential that cannot be used.
    pubKeyCredParams: [
      { type: "public-key", alg: -7 },
      { type: "public-key", alg: -257 },
      { type: "public-key", alg: -8 },
    ],
    authenticatorSelection: {
      residentKey: "required",
      userVerification: "required",
    },
    timeout: CHALLENGE_TTL_MS,
    attestation: "none",
    excludeCredentials: (data ?? []).map((row) => ({
      type: "public-key" as const,
      id: Buffer.from(bytesFromPostgrest(row.credential_id)).toString("base64url"),
      transports: row.transports ?? undefined,
    })),
  };
}

export type RegistrationOutcome =
  | { ok: true; passkeyId: string }
  | { ok: false; error: string };

/**
 * Verifies a new passkey and stores it.
 *
 * The challenge is consumed before anything is verified, so a failed ceremony
 * still burns it. That is deliberate: leaving a challenge alive after a failure
 * lets somebody retry against the same value indefinitely, which is most of what
 * single-use was for.
 */
export async function finishRegistration(input: {
  userId: string;
  challenge: string;
  attestationObject: Uint8Array;
  clientDataJSON: Uint8Array;
  transports?: string[];
  label?: string;
}): Promise<RegistrationOutcome> {
  const consumed = await consumeChallenge(input.challenge, "register");
  if (!consumed) return { ok: false, error: "That request expired. Try again." };

  // A challenge issued for one account must not complete for another.
  if (consumed.userId !== input.userId) {
    return { ok: false, error: "That request expired. Try again." };
  }

  let verified;
  try {
    verified = verifyRegistration({
      attestationObject: input.attestationObject,
      clientDataJSON: input.clientDataJSON,
      transports: input.transports,
      expected: { ...expectations(), challenge: input.challenge },
    });
  } catch (cause) {
    // The specific reason is useful to us and not to the browser: every one of
    // them is either a bug or an attack, and neither is helped by a detailed
    // message on the client.
    return {
      ok: false,
      error:
        cause instanceof WebAuthnError
          ? "That passkey could not be verified."
          : "That passkey could not be read.",
    };
  }

  const { data, error } = await db()
    .from("credentials")
    .insert({
      user_id: input.userId,
      credential_id: bytesForPostgrest(verified.credentialId),
      public_key: bytesForPostgrest(verified.publicKey),
      sign_count: verified.signCount,
      transports: verified.transports.length ? verified.transports : null,
      algorithm: verified.algorithm,
      backed_up: verified.backedUp,
      label: input.label?.slice(0, 60) ?? null,
    })
    .select("id")
    .single();

  if (error) {
    // `credentials.credential_id` is unique across the whole table, not per
    // user, so this fires when the passkey is already registered — possibly to
    // somebody else's account. The message says the same thing either way. Being
    // more helpful would turn registration into a way to ask "does this device
    // belong to another account here?".
    if (error.code === "23505") {
      return { ok: false, error: "That passkey is already registered." };
    }
    return { ok: false, error: "Could not save that passkey. Try again." };
  }

  return { ok: true, passkeyId: data.id };
}

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------

export interface AuthenticationOptions {
  challenge: string;
  rpId: string;
  timeout: number;
  userVerification: "required";
  allowCredentials: { type: "public-key"; id: string; transports?: string[] }[];
}

/**
 * Everything the browser needs to sign in with a passkey.
 *
 * `allowCredentials` is deliberately left empty. Naming the account's
 * credentials would mean looking them up from an address typed into a sign-in
 * box, and answering "which passkeys does this person have" to anybody who
 * asks — an account-enumeration oracle wearing a helpful face.
 *
 * Because registration asks for discoverable credentials, the authenticator
 * already knows what it holds for this site and offers it. Nobody has to type
 * anything at all, which is both more private and a better experience.
 */
export async function beginAuthentication(): Promise<AuthenticationOptions | null> {
  const challenge = await issueChallenge("authenticate", null);
  if (!challenge) return null;

  return {
    challenge,
    rpId: relyingPartyId(),
    timeout: CHALLENGE_TTL_MS,
    userVerification: "required",
    allowCredentials: [],
  };
}

export type AuthenticationOutcome =
  | { ok: true; userId: string; credentialId: string; clonedWarning: boolean }
  | { ok: false; error: string };

/**
 * Verifies a sign-in assertion and says whose account it was.
 *
 * Creating the session is the caller's job. This function deliberately stops at
 * "these bytes prove the holder of credential X was present", because that is
 * the security question — and keeping it separate means the session policy can
 * change without touching anything that verifies a signature.
 */
export async function finishAuthentication(input: {
  challenge: string;
  credentialId: Uint8Array;
  authenticatorData: Uint8Array;
  clientDataJSON: Uint8Array;
  signature: Uint8Array;
  userHandle?: Uint8Array | null;
}): Promise<AuthenticationOutcome> {
  const consumed = await consumeChallenge(input.challenge, "authenticate");
  if (!consumed) return { ok: false, error: "That sign-in request expired. Try again." };

  const { data: credential, error } = await db()
    .from("credentials")
    .select("id, user_id, public_key, sign_count")
    .eq("credential_id", bytesForPostgrest(input.credentialId))
    .maybeSingle();

  // A read failure and an unknown credential get the same answer for the same
  // reason a wrong password and a wrong address do: the difference is only
  // useful to somebody probing.
  if (error || !credential) {
    return { ok: false, error: "That passkey was not recognised." };
  }

  // When the authenticator returns a user handle it must agree with the account
  // the credential belongs to. It is a cross-check rather than the lookup — the
  // credential id is what identifies the row, and trusting a client-supplied
  // handle to choose the account would be trusting the client to say who it is.
  if (input.userHandle && input.userHandle.length > 0) {
    const claimed = Buffer.from(input.userHandle).toString("hex");
    const actual = credential.user_id.replace(/-/g, "");
    if (claimed !== actual) {
      return { ok: false, error: "That passkey was not recognised." };
    }
  }

  let result;
  try {
    result = verifyAuthentication({
      authenticatorData: input.authenticatorData,
      clientDataJSON: input.clientDataJSON,
      signature: input.signature,
      storedPublicKey: bytesFromPostgrest(credential.public_key),
      storedSignCount: credential.sign_count,
      expected: { ...expectations(), challenge: input.challenge },
    });
  } catch {
    return { ok: false, error: "That passkey could not be verified." };
  }

  // Recorded before returning, so a counter that has moved is persisted even if
  // the caller goes on to fail at creating a session. Errors are ignored here
  // and only here: a failed update costs a stale counter, and refusing a
  // sign-in that has already cryptographically succeeded would be the worse
  // outcome by far.
  await db()
    .from("credentials")
    .update({
      sign_count: result.signCount,
      last_used_at: new Date().toISOString(),
    })
    .eq("id", credential.id);

  return {
    ok: true,
    userId: credential.user_id,
    credentialId: credential.id,
    clonedWarning: result.clonedWarning,
  };
}

// ---------------------------------------------------------------------------
// Managing them
// ---------------------------------------------------------------------------

/** The account's passkeys, for the settings page. */
export async function listPasskeys(userId: string): Promise<StoredPasskey[]> {
  const { data, error } = await db()
    .from("credentials")
    .select("id, label, created_at, last_used_at, backed_up, sign_count")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });

  // Thrown rather than defaulted to empty. An empty list here is the answer to
  // "what can I sign in with", and inventing it could talk somebody into
  // deleting the credential they actually needed.
  if (error) throw new Error(`Could not list passkeys: ${error.message}`);

  return (data ?? []).map((row) => ({
    id: row.id,
    label: row.label,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    backedUp: row.backed_up,
    signCount: row.sign_count,
  }));
}

export type RemoveOutcome = { ok: true } | { ok: false; error: string };

/**
 * Removes a passkey, unless it is the only way in.
 *
 * This is the lockout guard, and it is the reason this function is not a
 * one-line delete. An account with one passkey and no password that deletes the
 * passkey is unreachable forever — there is no credential left to present and
 * no password to reset. The database cannot express "at least one of two
 * columns across two tables", so the rule lives here, and the refusal is the
 * feature.
 */
export async function removePasskey(
  userId: string,
  passkeyId: string,
): Promise<RemoveOutcome> {
  const { data: user, error: userError } = await db()
    .from("users")
    .select("password_hash")
    .eq("id", userId)
    .maybeSingle();

  // Fails closed. If we cannot tell whether a password exists, we must not
  // assume one does — that assumption is what locks somebody out permanently.
  if (userError || !user) {
    return { ok: false, error: "Could not check your account. Try again." };
  }

  if (!user.password_hash) {
    const { count, error: countError } = await db()
      .from("credentials")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId);

    if (countError) return { ok: false, error: "Could not check your account. Try again." };
    if ((count ?? 0) <= 1) {
      return {
        ok: false,
        error:
          "This is the only way into your account. Add another passkey or set a password first.",
      };
    }
  }

  const { error, count } = await db()
    .from("credentials")
    .delete({ count: "exact" })
    .eq("id", passkeyId)
    // Scoped to the owner. Without this, a guessed id deletes somebody else's
    // passkey — and on an account with only one, locks them out.
    .eq("user_id", userId);

  if (error) return { ok: false, error: "Could not remove that passkey. Try again." };
  if ((count ?? 0) === 0) return { ok: false, error: "That passkey is already gone." };
  return { ok: true };
}

/** Renames a passkey. Scoped to the owner for the same reason removal is. */
export async function renamePasskey(
  userId: string,
  passkeyId: string,
  label: string,
): Promise<RemoveOutcome> {
  const trimmed = label.trim().slice(0, 60);
  if (!trimmed) return { ok: false, error: "Give it a name." };

  const { error, count } = await db()
    .from("credentials")
    .update({ label: trimmed }, { count: "exact" })
    .eq("id", passkeyId)
    .eq("user_id", userId);

  if (error) return { ok: false, error: "Could not rename that passkey. Try again." };
  if ((count ?? 0) === 0) return { ok: false, error: "That passkey is gone." };
  return { ok: true };
}
