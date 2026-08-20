import "server-only";

import { normaliseEmail } from "../auth/email";
import {
  RESET_TOKEN_MS,
  VERIFY_TOKEN_MS,
  hashTokenForPostgrest,
  newToken,
} from "../auth/tokens";
import {
  sendPasswordChangedEmail,
  sendPasswordResetEmail,
  sendVerificationEmail,
} from "./email";
import { revokeAllSessions } from "./sessions";
import { markEmailVerified, setPassword, userByEmail } from "./users";
import { db } from "./supabase";

/**
 * Confirming an address, and getting back in after forgetting a password.
 *
 * One table and one mechanism behind both: a random token, mailed once, good
 * for a short time, usable once. Two tables would be two places to get expiry
 * and single-use wrong.
 *
 * ## Why these keep a consumed flag when WebAuthn challenges do not
 *
 * A challenge is deleted the instant it is redeemed, because nobody ever sees
 * one and there is nothing to explain. A link in an email is different: people
 * click them twice, mail clients prefetch them, and threads get forwarded. The
 * row has to survive redemption so that the second click can be told "already
 * verified" instead of "invalid link", which is the difference between a
 * reassuring page and a person convinced the site is broken.
 *
 * ## The rule about not revealing who has an account
 *
 * `startPasswordReset` returns the same thing for an address with an account
 * and one without, and does the same amount of database work either way. The
 * caller is expected to run it through `after()` so the response is sent before
 * any of it happens — which removes the timing difference entirely rather than
 * trying to balance it. See the note on that function.
 */

/**
 * How many links may be sent before the answer is silently no.
 *
 * A reset endpoint without a cap is a way to send somebody a stream of mail
 * they did not ask for, using our sender's reputation to do it. Three in a
 * quarter of an hour covers a person who did not receive the first one; the
 * fourth is not a person.
 */
const MAX_RESETS_PER_WINDOW = 3;
const RESET_WINDOW_MS = 15 * 60 * 1000;
const MAX_VERIFICATIONS_PER_WINDOW = 5;
const VERIFY_WINDOW_MS = 60 * 60 * 1000;

type Purpose = "verify" | "reset";

async function issuedRecently(
  userId: string,
  purpose: Purpose,
  windowMs: number,
): Promise<number | null> {
  const since = new Date(Date.now() - windowMs).toISOString();
  const { count, error } = await db()
    .from("email_tokens")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("purpose", purpose)
    .gte("created_at", since);

  // Null means "could not tell", and every caller treats that as over the limit.
  // `count ?? 0` here would read as "none sent yet" and turn a database blip
  // into an uncapped mailer.
  if (error) return null;
  return count ?? 0;
}

/** Creates a token and returns the value that goes in the link. */
async function issueToken(userId: string, purpose: Purpose): Promise<string | null> {
  const token = newToken();
  const ttl = purpose === "reset" ? RESET_TOKEN_MS : VERIFY_TOKEN_MS;

  const { error } = await db().from("email_tokens").insert({
    user_id: userId,
    purpose,
    token_hash: hashTokenForPostgrest(token),
    expires_at: new Date(Date.now() + ttl).toISOString(),
  });

  if (error) return null;
  return token;
}

export type RedeemResult =
  | { ok: true; userId: string }
  | { ok: false; reason: "unknown" | "expired" | "used" };

/**
 * Redeems a token exactly once.
 *
 * The update is conditional — `consumed_at is null` is part of the match, not a
 * check performed beforehand — so two requests racing the same link cannot both
 * succeed. A read, a decision and a write would leave a window between them,
 * and a mail client that prefetches a link while the person also clicks it hits
 * that window routinely.
 *
 * The three failure reasons are distinguished because the *person holding the
 * link* deserves to know which it was. This leaks nothing: they already have
 * the token, so telling them it has expired reveals nothing they could not
 * determine by using it.
 */
export async function redeemToken(token: string, purpose: Purpose): Promise<RedeemResult> {
  if (!token) return { ok: false, reason: "unknown" };

  const now = new Date().toISOString();
  const { data, error } = await db()
    .from("email_tokens")
    .update({ consumed_at: now })
    .eq("token_hash", hashTokenForPostgrest(token))
    .eq("purpose", purpose)
    .is("consumed_at", null)
    .gt("expires_at", now)
    .select("user_id")
    .maybeSingle();

  if (error) return { ok: false, reason: "unknown" };
  if (data) return { ok: true, userId: data.user_id };

  // Nothing matched. Look at why, so the page can say something true — but
  // only ever for a token the caller already holds.
  const { data: existing } = await db()
    .from("email_tokens")
    .select("consumed_at, expires_at")
    .eq("token_hash", hashTokenForPostgrest(token))
    .eq("purpose", purpose)
    .maybeSingle();

  if (!existing) return { ok: false, reason: "unknown" };
  if (existing.consumed_at) return { ok: false, reason: "used" };
  return { ok: false, reason: "expired" };
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

/**
 * Sends a fresh confirmation link.
 *
 * Silently does nothing when the address is already confirmed or the cap is
 * reached. The caller tells the person "check your inbox" either way — there is
 * nothing useful to distinguish, and an error here would only ever be read as
 * "the site is broken".
 */
export async function startEmailVerification(user: {
  id: string;
  email: string;
  emailVerifiedAt: string | null;
}): Promise<void> {
  if (user.emailVerifiedAt) return;

  const recent = await issuedRecently(user.id, "verify", VERIFY_WINDOW_MS);
  if (recent === null || recent >= MAX_VERIFICATIONS_PER_WINDOW) return;

  const token = await issueToken(user.id, "verify");
  if (!token) return;

  const result = await sendVerificationEmail(user.email, token);
  if (result.mode === "failed") {
    // Logged rather than thrown. The token is already valid, so a retry sends a
    // new link rather than resurrecting a broken flow, and failing the request
    // would tell somebody about a problem they cannot act on.
    console.error(`[email] verification to ${user.email} failed: ${result.error}`);
  }
}

export type VerifyOutcome =
  | { ok: true }
  | { ok: false; reason: "unknown" | "expired" | "used" };

/** Confirms an address from a link. */
export async function completeEmailVerification(token: string): Promise<VerifyOutcome> {
  const redeemed = await redeemToken(token, "verify");
  if (!redeemed.ok) return redeemed;

  const marked = await markEmailVerified(redeemed.userId);
  if (!marked) {
    // The token is spent and the flag did not land. Reported as unknown rather
    // than as success, because claiming an address is verified when the column
    // says otherwise is the kind of lie that surfaces much later, during a
    // password reset, when it matters most.
    return { ok: false, reason: "unknown" };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Password reset
// ---------------------------------------------------------------------------

/**
 * Begins a password reset, revealing nothing.
 *
 * Returns void — deliberately, so that no caller can accidentally branch on
 * whether an account was found and turn this into the enumeration oracle it
 * exists to avoid. There is exactly one thing the interface may say afterwards,
 * and it is "if that address has an account, a link is on its way".
 *
 * **Run this through `after()`.** The work here is a lookup, a rate check, an
 * insert and an HTTP call for an address that exists, and a lookup alone for
 * one that does not. Awaiting it inside the request makes those two paths
 * measurably different lengths, which hands back exactly the answer the
 * constant message withholds. Deferring it until the response has been sent
 * removes the difference rather than trying to balance it.
 */
export async function startPasswordReset(email: string): Promise<void> {
  const user = await userByEmail(normaliseEmail(email));
  if (!user) return;

  const recent = await issuedRecently(user.id, "reset", RESET_WINDOW_MS);
  if (recent === null || recent >= MAX_RESETS_PER_WINDOW) return;

  const token = await issueToken(user.id, "reset");
  if (!token) return;

  const result = await sendPasswordResetEmail(user.email, token);
  if (result.mode === "failed") {
    console.error(`[email] reset to ${user.email} failed: ${result.error}`);
  }
}

export type ResetOutcome =
  | { ok: true }
  | { ok: false; reason: "unknown" | "expired" | "used"; error?: undefined }
  | { ok: false; reason: "weak"; error: string };

/**
 * Finishes a reset: sets the password and signs every device out.
 *
 * The revocation is the point, not housekeeping. A reset exists because
 * somebody may have lost control of the account, and a new password that leaves
 * the intruder's session alive has not taken it back — it has only changed the
 * lock while they are still inside.
 *
 * The password is validated *before* the token is spent, so somebody who picks
 * something too short does not have to request a whole new link to try again.
 */
export async function completePasswordReset(
  token: string,
  password: string,
): Promise<ResetOutcome> {
  const { checkPassword } = await import("../auth/password");
  const problem = checkPassword(password);
  if (!problem.ok) return { ok: false, reason: "weak", error: problem.reason };

  const redeemed = await redeemToken(token, "reset");
  if (!redeemed.ok) return redeemed;

  const saved = await setPassword(redeemed.userId, password);
  if (!saved.ok) return { ok: false, reason: "unknown" };

  // Everything, with no exception for the requesting device: whoever is
  // resetting is about to sign in with the password they just chose, and an
  // exemption here would be a way for an intruder holding a session to keep it.
  await revokeAllSessions(redeemed.userId);

  // Best effort and after the fact. This is the message that makes a stolen
  // account survivable, so it is sent even though the reset has already
  // succeeded — and its failure must not undo a completed reset.
  const { data } = await db()
    .from("users")
    .select("email")
    .eq("id", redeemed.userId)
    .maybeSingle();
  if (data?.email) void sendPasswordChangedEmail(data.email).catch(() => {});

  return { ok: true };
}

/**
 * Deletes tokens that can no longer be redeemed.
 *
 * Expired ones go immediately. Consumed ones are kept for a day so that a
 * second click still says "already used" rather than "invalid link" — the
 * distinction this table keeps a flag for in the first place, which would be
 * thrown away by deleting on redemption.
 */
export async function sweepEmailTokens(): Promise<number> {
  const now = new Date().toISOString();
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { count, error } = await db()
    .from("email_tokens")
    .delete({ count: "exact" })
    .or(`expires_at.lte.${now},consumed_at.lte.${dayAgo}`);

  if (error) return 0;
  return count ?? 0;
}
