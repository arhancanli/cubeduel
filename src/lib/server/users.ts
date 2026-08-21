import "server-only";

import { isPlausibleEmail, normaliseEmail } from "../auth/email";
import {
  checkPassword,
  hashPassword,
  needsRehash,
  verifyPasswordOrBurn,
} from "../auth/password";
import { db } from "./supabase";

/**
 * Accounts.
 *
 * Thin on purpose: an address, an optional password, and whether the address
 * has been confirmed. Everything a player can see about themselves — handle,
 * display name, country, bio — lives on `profiles`, so the table holding
 * credentials is never read to render a page.
 *
 * ## The rule every function here follows
 *
 * Nothing in this file lets an outsider learn whether an address has an
 * account. That sounds like a small thing and it is not: an endpoint that
 * answers it turns a leaked address list into a list of *this site's users*,
 * which is the raw material for every credential-stuffing run. So sign-up,
 * sign-in and password reset all answer the same way for an address that
 * exists and one that does not, and take comparable time doing it.
 *
 * The one place that cannot obey this is sign-up itself, which has to refuse a
 * duplicate somehow. See `createUser` for what is done instead.
 */

export interface AccountUser {
  id: string;
  email: string;
  emailVerifiedAt: string | null;
  hasPassword: boolean;
}

function shape(row: {
  id: string;
  email: string;
  email_verified_at: string | null;
  password_hash: string | null;
}): AccountUser {
  return {
    id: row.id,
    email: row.email,
    emailVerifiedAt: row.email_verified_at,
    hasPassword: Boolean(row.password_hash),
  };
}

/** Looks up an account by address. Returns null when there is none. */
export async function userByEmail(email: string): Promise<AccountUser | null> {
  const normalised = normaliseEmail(email);
  if (!isPlausibleEmail(normalised)) return null;

  const { data, error } = await db()
    .from("users")
    .select("id, email, email_verified_at, password_hash")
    .eq("email", normalised)
    .maybeSingle();

  if (error || !data) return null;
  return shape(data);
}

export type CreateOutcome =
  | { ok: true; user: AccountUser; created: true }
  | { ok: true; user: AccountUser; created: false }
  | { ok: false; error: string };

/**
 * Creates an account, or reports that the address is already taken.
 *
 * This is the one endpoint that cannot hide whether an address is registered,
 * because it has to refuse a second account on the same address. Rather than
 * pretend otherwise with a fake success — which produces somebody staring at a
 * confirmation email that never comes — it says so plainly and points at
 * sign-in.
 *
 * The mitigation is that this path is rate limited and that the message is the
 * *only* place it leaks. Sign-in and reset, which are far more attractive to
 * probe at volume, give nothing away.
 *
 * `created: false` is returned rather than an error when the existing account
 * has no password and no passkeys — an abandoned shell from somebody who
 * started signing up and never finished. Treating that as "taken" would make
 * the address permanently unusable by the person who owns it.
 */
export async function createUser(input: {
  email: string;
  password?: string;
}): Promise<CreateOutcome> {
  const email = normaliseEmail(input.email);
  if (!isPlausibleEmail(email)) {
    return { ok: false, error: "That doesn't look like an email address." };
  }

  let passwordHash: string | null = null;
  if (input.password !== undefined) {
    const problem = checkPassword(input.password);
    if (!problem.ok) return { ok: false, error: problem.reason };
    passwordHash = await hashPassword(input.password);
  }

  const { data, error } = await db()
    .from("users")
    .insert({ email, password_hash: passwordHash })
    .select("id, email, email_verified_at, password_hash")
    .single();

  if (!error && data) return { ok: true, user: shape(data), created: true };

  if (error?.code === "23505") {
    const existing = await userByEmail(email);
    if (!existing) {
      // The insert said the row exists and the read cannot find it. Rather than
      // guess, say something true and unhelpful — the alternative is claiming a
      // state we could not confirm.
      return { ok: false, error: "Could not create that account. Try again." };
    }

    // An abandoned shell: no password, no passkey. Handing it back lets the
    // person who owns the address finish what they started instead of being
    // permanently locked out of their own email by their own half-finished
    // attempt.
    const { count, error: countError } = await db()
      .from("credentials")
      .select("id", { count: "exact", head: true })
      .eq("user_id", existing.id);

    // Fails closed: if we cannot count credentials we must not hand the account
    // over, because handing over an account that has some is account takeover.
    if (countError) return { ok: false, error: "Could not create that account. Try again." };

    if (!existing.hasPassword && (count ?? 0) === 0) {
      // Claiming a shell means applying whatever credential the caller brought
      // with them. Returning the row untouched — which this did until the
      // integration suite caught it — is a sign-up that appears to succeed and
      // then refuses the very password it just accepted, with no way for the
      // person to tell what went wrong.
      if (!passwordHash) return { ok: true, user: existing, created: false };

      const { data: claimed, error: claimError } = await db()
        .from("users")
        .update({ password_hash: passwordHash, updated_at: new Date().toISOString() })
        .eq("id", existing.id)
        // Still a shell, as part of the match rather than a check beforehand.
        // Two people signing up on the same abandoned address at once must not
        // both come away believing they own it; whoever loses this update is
        // told the address is taken, which by then it is.
        .is("password_hash", null)
        .select("id, email, email_verified_at, password_hash")
        .maybeSingle();

      if (claimError || !claimed) {
        return { ok: false, error: "There's already an account on that address. Sign in instead." };
      }
      return { ok: true, user: shape(claimed), created: false };
    }

    return { ok: false, error: "There's already an account on that address. Sign in instead." };
  }

  return { ok: false, error: "Could not create that account. Try again." };
}

export type PasswordOutcome = { ok: true } | { ok: false; error: string };

/**
 * Sets or replaces the password on an account.
 *
 * Does **not** revoke sessions — the callers do, and they differ. A reset must
 * sign every device out, because the whole point is taking the account back
 * from somebody. A person changing their password from the settings page should
 * stay signed in on the device they are using. Putting the revocation here
 * would force one of those to be wrong.
 */
export async function setPassword(
  userId: string,
  password: string,
): Promise<PasswordOutcome> {
  const problem = checkPassword(password);
  if (!problem.ok) return { ok: false, error: problem.reason };

  const { error } = await db()
    .from("users")
    .update({
      password_hash: await hashPassword(password),
      updated_at: new Date().toISOString(),
    })
    .eq("id", userId);

  if (error) return { ok: false, error: "Could not save that password. Try again." };
  return { ok: true };
}

/**
 * Checks a password and returns the account, or null.
 *
 * Two properties this has that a plain lookup-and-compare does not:
 *
 * **It costs the same whether or not the account exists.**
 * `verifyPasswordOrBurn` hashes against a throwaway when there is nothing to
 * check, so "no such address" is not measurably faster than "wrong password".
 * Without that, the sign-in form is an account-enumeration oracle that answers
 * in milliseconds.
 *
 * **It upgrades the stored hash when the cost parameters have moved on.**
 * Sign-in is the only moment the plaintext exists, so it is the only moment an
 * upgrade is possible — which is how the whole table migrates to stronger
 * parameters without a flag day and without asking anybody to do anything.
 */
export async function checkCredentials(
  email: string,
  password: string,
): Promise<AccountUser | null> {
  const normalised = normaliseEmail(email);

  const { data } = await db()
    .from("users")
    .select("id, email, email_verified_at, password_hash")
    .eq("email", normalised)
    .maybeSingle();

  const stored = data?.password_hash ?? null;
  const matched = await verifyPasswordOrBurn(password, stored);
  if (!matched || !data) return null;

  if (needsRehash(stored)) {
    // Not awaited for correctness and its failure is ignored: the sign-in has
    // already succeeded, and refusing it because an optimisation did not land
    // would be the worse outcome by a wide margin.
    void db()
      .from("users")
      .update({ password_hash: await hashPassword(password) })
      .eq("id", data.id)
      .then(() => undefined);
  }

  return shape(data);
}

/** Records that an address has been confirmed. */
export async function markEmailVerified(userId: string): Promise<boolean> {
  const { error } = await db()
    .from("users")
    .update({
      email_verified_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", userId);

  return !error;
}

/**
 * Deletes an account and everything hanging off it.
 *
 * One statement. Every table that references a user does so with `on delete
 * cascade`, which is deliberate — the previous incarnation of this depended on
 * a webhook that was live, correct, tested, and refusing every request because
 * a secret was never set in the host environment. Twenty-eight profiles
 * outlived accounts that no longer existed. A foreign key needs no
 * configuration and cannot be forgotten.
 */
export async function deleteUser(userId: string): Promise<boolean> {
  const { error } = await db().from("users").delete().eq("id", userId);
  return !error;
}
