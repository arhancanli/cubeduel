import { db } from "../src/lib/server/supabase";

/**
 * Throwaway accounts for the integration suites.
 *
 * Every suite used to insert a profile directly with a made-up
 * `clerk_user_id`, because the column was free text and nothing checked it.
 * `profiles.user_id` has a foreign key to `users`, so a profile now needs a
 * real account behind it — which is a small tax and a genuine improvement: the
 * suites exercise the same shape production does, instead of a state only a
 * test can reach.
 *
 * Addresses all end in `@cubeduel.test`, which is a reserved TLD that cannot
 * resolve. Nothing here can accidentally mail a real person, however wrong the
 * mail configuration is.
 */

export const PROBE_DOMAIN = "cubeduel.test";

export interface ProbeAccount {
  userId: string;
  email: string;
}

/**
 * Creates an account with no password and no passkey.
 *
 * That is a legitimate state, not a shortcut — it is exactly what the claim
 * flow produces between creating the account and registering a passkey — so
 * the suites are not relying on anything the product cannot do.
 */
export async function makeProbeAccount(label: string): Promise<ProbeAccount> {
  const email = `${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@${PROBE_DOMAIN}`;

  const { data, error } = await db()
    .from("users")
    .insert({ email })
    .select("id, email")
    .single();

  // Thrown rather than returned. A suite that carries on without an account
  // fails later, somewhere unrelated, with an error about a foreign key.
  if (error || !data) {
    throw new Error(`could not create probe account: ${error?.message ?? "no row"}`);
  }
  return { userId: data.id, email: data.email };
}

/** Creates an account and a profile for it, which is what most suites want. */
export async function makeProbeProfile(
  label: string,
  handle: string,
  displayName: string,
) {
  const account = await makeProbeAccount(label);

  const { data, error } = await db()
    .from("profiles")
    .insert({ user_id: account.userId, handle, display_name: displayName })
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(`could not create probe profile: ${error?.message ?? "no row"}`);
  }
  return { account, profile: data };
}

/**
 * Removes every probe account, and with it every profile, solve and session.
 *
 * One statement, because `users` cascades. Deleting profiles first — which is
 * what the suites used to do — now leaves the accounts behind, and those
 * accumulate silently because nothing shows them.
 */
export async function cleanupProbes(): Promise<void> {
  await db().from("users").delete().like("email", `%@${PROBE_DOMAIN}`);
}
