/**
 * Passkeys against the real database.
 *
 * The unit tests cover whether a ceremony verifies — every rejection path in
 * `auth/webauthn.ts` is exercised there against a real software authenticator.
 * This covers the half that only exists once Postgres is involved: that a
 * challenge can be redeemed exactly once, that a challenge issued for one
 * account cannot be completed by another, that the sign-in counter is
 * persisted, and that an account cannot delete its own only way in.
 *
 *   npm run integration:passkeys
 *
 * Requires migrations 0007 and 0008. It cleans up after itself.
 */
import { randomUUID } from "node:crypto";

import { hashPassword } from "../src/lib/auth/password";
import { TestAuthenticator } from "../src/lib/auth/testAuthenticator";
import { hashTokenForPostgrest } from "../src/lib/auth/tokens";
import {
  beginAuthentication,
  beginRegistration,
  consumeChallenge,
  finishAuthentication,
  finishRegistration,
  issueChallenge,
  listPasskeys,
  removePasskey,
  renamePasskey,
  sweepExpiredChallenges,
} from "../src/lib/server/passkeys";
import { db } from "../src/lib/server/supabase";

const EMAIL_A = "passkey-probe-a@cubeduel.test";
const EMAIL_B = "passkey-probe-b@cubeduel.test";

let failures = 0;

function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`  [${ok ? "PASS" : "FAIL"}] ${label}${detail ? `  -> ${detail}` : ""}`);
}

async function cleanup() {
  await db().from("users").delete().in("email", [EMAIL_A, EMAIL_B]);
}

async function makeUser(email: string, withPassword = false) {
  const { data, error } = await db()
    .from("users")
    .insert({
      email,
      password_hash: withPassword ? await hashPassword("a real password here") : null,
    })
    .select("id, email")
    .single();

  if (error) throw new Error(`could not create ${email}: ${error.message}`);
  return { id: data.id, email: data.email, displayName: "Probe" };
}

/**
 * The relying party the test authenticator must impersonate.
 *
 * Read from the same place the server reads it, rather than hardcoded — a test
 * that hardcodes "localhost" passes locally and silently stops testing anything
 * the moment SITE_URL is set to something else.
 */
const { deriveRelyingParty } = await import("../src/lib/auth/relyingParty");
const { SITE_URL } = await import("../src/lib/site");
const RP = deriveRelyingParty(SITE_URL);

function authenticator() {
  return new TestAuthenticator({ rpId: RP.id, origin: RP.origin });
}

async function main() {
  console.log(`Relying party: id=${RP.id} origin=${RP.origin}`);
  await cleanup();

  const userA = await makeUser(EMAIL_A);
  const userB = await makeUser(EMAIL_B);

  // -------------------------------------------------------------------------
  console.log("\n== a challenge is redeemable exactly once ==");

  {
    const challenge = await issueChallenge("register", userA.id);
    check("a challenge was issued", Boolean(challenge));

    const first = await consumeChallenge(challenge!, "register");
    check("the first redemption succeeds", first?.userId === userA.id);

    const second = await consumeChallenge(challenge!, "register");
    check("the second redemption finds nothing", second === null);
  }

  // -------------------------------------------------------------------------
  console.log("\n== two requests racing the same challenge ==");

  {
    // The reason consumption is DELETE ... RETURNING rather than read-then-
    // write. If both of these come back with a user, the window between a read
    // and a delete is real and a captured ceremony can be replayed through it.
    const challenge = await issueChallenge("register", userA.id);
    const [one, two] = await Promise.all([
      consumeChallenge(challenge!, "register"),
      consumeChallenge(challenge!, "register"),
    ]);

    const winners = [one, two].filter(Boolean).length;
    check("exactly one of two concurrent redemptions wins", winners === 1, `${winners} won`);
  }

  // -------------------------------------------------------------------------
  console.log("\n== a challenge cannot cross purposes ==");

  {
    const challenge = await issueChallenge("register", userA.id);
    const wrong = await consumeChallenge(challenge!, "authenticate");
    check("a register challenge is not redeemable as a sign-in", wrong === null);

    // And the row survives the mismatch rather than being consumed by it.
    const right = await consumeChallenge(challenge!, "register");
    check("...and the challenge is still usable for what it was issued for", right !== null);
  }

  // -------------------------------------------------------------------------
  console.log("\n== an expired challenge is refused ==");

  {
    const challenge = await issueChallenge("register", userA.id);
    // Reach past the API to age it, which is the only way to test expiry
    // without waiting five minutes.
    const { error } = await db()
      .from("webauthn_challenges")
      .update({ expires_at: new Date(Date.now() - 1000).toISOString() })
      .eq("challenge_hash", hashTokenForPostgrest(challenge!));
    check("the challenge could be aged", !error, error?.message ?? "");

    check("an expired challenge is refused", (await consumeChallenge(challenge!, "register")) === null);
  }

  // -------------------------------------------------------------------------
  console.log("\n== registering a passkey ==");

  const device = authenticator();
  let registeredId = "";

  {
    const options = await beginRegistration(userA);
    check("registration options were issued", Boolean(options));
    check("the relying party id is the bare domain", options?.rp.id === RP.id, options?.rp.id);
    check("a discoverable credential is requested", options?.authenticatorSelection.residentKey === "required");
    check("user verification is required", options?.authenticatorSelection.userVerification === "required");
    check("no credentials are excluded yet", options?.excludeCredentials.length === 0);

    const response = device.register(options!.challenge);
    const result = await finishRegistration({
      userId: userA.id,
      challenge: options!.challenge,
      ...response,
    });

    check("the passkey was accepted and stored", result.ok, result.ok ? "" : result.error);
    if (result.ok) registeredId = result.passkeyId;
  }

  // -------------------------------------------------------------------------
  console.log("\n== the stored row is real, not merely reported ==");

  {
    // Remembering that a challenge solve once reported success while storing
    // nothing at all: assert the ROW, never the return value alone.
    const { data } = await db()
      .from("credentials")
      .select("id, user_id, algorithm, backed_up, sign_count")
      .eq("user_id", userA.id);

    check("exactly one credential row exists", (data ?? []).length === 1, `${(data ?? []).length} rows`);
    check("the algorithm was recorded", data?.[0]?.algorithm === -7, String(data?.[0]?.algorithm));
    check("the backup state was recorded", data?.[0]?.backed_up === true);
  }

  // -------------------------------------------------------------------------
  console.log("\n== the second registration excludes the first ==");

  {
    const options = await beginRegistration(userA);
    check("the existing credential is now excluded", options?.excludeCredentials.length === 1, String(options?.excludeCredentials.length));
  }

  // -------------------------------------------------------------------------
  console.log("\n== a challenge issued for one account cannot register on another ==");

  {
    const options = await beginRegistration(userA);
    const response = authenticator().register(options!.challenge);

    const result = await finishRegistration({
      userId: userB.id, // ...but completed as B
      challenge: options!.challenge,
      ...response,
    });

    check("registering B's passkey on A's challenge is refused", !result.ok);

    const { count } = await db()
      .from("credentials")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userB.id);
    check("...and nothing was stored for B", (count ?? 0) === 0, `${count} rows`);
  }

  // -------------------------------------------------------------------------
  console.log("\n== signing in ==");

  {
    const options = await beginAuthentication();
    check("sign-in options were issued", Boolean(options));
    check(
      "no credentials are named, so the endpoint reveals nothing",
      options?.allowCredentials.length === 0,
    );

    const assertion = device.authenticate(options!.challenge);
    const result = await finishAuthentication({
      challenge: options!.challenge,
      credentialId: device.credentialId,
      ...assertion,
    });

    check("the assertion signed in", result.ok, result.ok ? "" : result.error);
    check("...as the right account", result.ok && result.userId === userA.id);
    check("...and was not flagged as cloned", result.ok && !result.clonedWarning);
  }

  // -------------------------------------------------------------------------
  console.log("\n== the counter is persisted, not just returned ==");

  {
    const { data } = await db()
      .from("credentials")
      .select("sign_count, last_used_at")
      .eq("user_id", userA.id)
      .single();

    check("the sign counter moved past zero", (data?.sign_count ?? 0) > 0, String(data?.sign_count));
    check("last use was recorded", Boolean(data?.last_used_at));
  }

  // -------------------------------------------------------------------------
  console.log("\n== a replayed assertion is refused ==");

  {
    // The whole reason challenges exist. Capture one complete, valid sign-in
    // and send it again.
    const options = await beginAuthentication();
    const assertion = device.authenticate(options!.challenge);

    const first = await finishAuthentication({
      challenge: options!.challenge,
      credentialId: device.credentialId,
      ...assertion,
    });
    check("the assertion works once", first.ok);

    const replay = await finishAuthentication({
      challenge: options!.challenge,
      credentialId: device.credentialId,
      ...assertion,
    });
    check("the identical assertion is refused the second time", !replay.ok);
  }

  // -------------------------------------------------------------------------
  console.log("\n== an unknown credential is refused ==");

  {
    const stranger = authenticator();
    const options = await beginAuthentication();
    const assertion = stranger.authenticate(options!.challenge);

    const result = await finishAuthentication({
      challenge: options!.challenge,
      credentialId: stranger.credentialId,
      ...assertion,
    });
    check("a credential nobody registered is refused", !result.ok);
  }

  // -------------------------------------------------------------------------
  console.log("\n== a mismatched user handle is refused ==");

  {
    const options = await beginAuthentication();
    const assertion = device.authenticate(options!.challenge);

    const result = await finishAuthentication({
      challenge: options!.challenge,
      credentialId: device.credentialId,
      userHandle: Buffer.from(randomUUID().replace(/-/g, ""), "hex"),
      ...assertion,
    });
    check("a handle naming another account is refused", !result.ok);
  }

  // -------------------------------------------------------------------------
  console.log("\n== the lockout guard ==");

  {
    const before = await listPasskeys(userA.id);
    check("the account has exactly one passkey", before.length === 1, `${before.length}`);

    const removal = await removePasskey(userA.id, registeredId);
    check("removing the only way in is refused", !removal.ok, removal.ok ? "" : removal.error);

    const after = await listPasskeys(userA.id);
    check("...and the passkey is still there", after.length === 1, `${after.length}`);
  }

  // -------------------------------------------------------------------------
  console.log("\n== removal is allowed once there is another way in ==");

  {
    const second = authenticator();
    const options = await beginRegistration(userA);
    const result = await finishRegistration({
      userId: userA.id,
      challenge: options!.challenge,
      ...second.register(options!.challenge),
      label: "second device",
    });
    check("a second passkey was added", result.ok, result.ok ? "" : result.error);

    const removal = await removePasskey(userA.id, registeredId);
    check("now the first can be removed", removal.ok, removal.ok ? "" : removal.error);
    check("one passkey remains", (await listPasskeys(userA.id)).length === 1);
  }

  // -------------------------------------------------------------------------
  console.log("\n== one account cannot touch another's passkeys ==");

  {
    const mine = (await listPasskeys(userA.id))[0];

    // B is given two passkeys of their own FIRST, and this is the whole point
    // of the section rather than set-up noise.
    //
    // Without it the lockout guard refuses B before ownership is ever
    // considered — B has no credentials, so "this is your only way in" fires
    // and the check passes for a reason that has nothing to do with the
    // passkey belonging to somebody else. Mutation-testing found exactly that:
    // deleting the `.eq("user_id", ...)` scoping from removePasskey left this
    // section green. A guard that cannot fail is worse than no guard, because
    // it is believed.
    //
    // With two credentials of their own, B is past the lockout guard, and the
    // only thing left standing between B and A's passkey is the owner scoping.
    for (const label of ["b-first", "b-second"]) {
      const options = await beginRegistration(userB);
      const result = await finishRegistration({
        userId: userB.id,
        challenge: options!.challenge,
        ...authenticator().register(options!.challenge),
        label,
      });
      check(`B registered ${label}`, result.ok, result.ok ? "" : result.error);
    }
    check("B now has two passkeys, so the lockout guard cannot fire", (await listPasskeys(userB.id)).length === 2);

    const stolenRemove = await removePasskey(userB.id, mine.id);
    check("B cannot remove A's passkey", !stolenRemove.ok);
    check("...and it is still there", (await listPasskeys(userA.id)).length === 1);
    check("...and B's own passkeys are untouched", (await listPasskeys(userB.id)).length === 2);

    const stolenRename = await renamePasskey(userB.id, mine.id, "owned");
    check("B cannot rename A's passkey", !stolenRename.ok);
    check(
      "...and the label is unchanged",
      (await listPasskeys(userA.id))[0].label === "second device",
      String((await listPasskeys(userA.id))[0].label),
    );
  }

  // -------------------------------------------------------------------------
  console.log("\n== a password is an alternative way in ==");

  {
    // With a password set, the last passkey may be removed — the account is
    // still reachable.
    await db().from("users").update({ password_hash: await hashPassword("a real password here") }).eq("id", userA.id);

    const only = (await listPasskeys(userA.id))[0];
    const removal = await removePasskey(userA.id, only.id);
    check("the last passkey can go once a password exists", removal.ok, removal.ok ? "" : removal.error);
    check("no passkeys remain", (await listPasskeys(userA.id)).length === 0);
  }

  // -------------------------------------------------------------------------
  console.log("\n== the rate limit fails closed ==");

  {
    const fresh = await makeUser(`ratelimit-${randomUUID()}@cubeduel.test`);
    let issued = 0;
    for (let i = 0; i < 15; i++) {
      if (await issueChallenge("register", fresh.id)) issued++;
    }
    check("challenge issuing is capped", issued === 10, `${issued} issued`);
    await db().from("users").delete().eq("id", fresh.id);
  }

  // -------------------------------------------------------------------------
  console.log("\n== the sweep removes only what is dead ==");

  {
    const live = await issueChallenge("authenticate", null);
    await sweepExpiredChallenges();
    check("a live challenge survives the sweep", (await consumeChallenge(live!, "authenticate")) !== null);
  }

  console.log("\n== cleanup ==");
  await cleanup();
}

main()
  .catch(async (error) => {
    console.error("\nUNCAUGHT:", error);
    failures++;
    await cleanup().catch(() => {});
  })
  .finally(() => {
    console.log(failures === 0 ? "\nAll checks passed." : `\nFAILURES: ${failures}`);
    process.exit(failures === 0 ? 0 : 1);
  });
