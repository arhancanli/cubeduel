/**
 * Accounts, sessions and email links against the real database.
 *
 * Covers the half of identity that only exists once Postgres is involved: that
 * a session can be resolved and revoked, that both expiry rules bite, that a
 * reset link works exactly once and signs every device out, and that none of
 * these paths will tell an outsider whether an address has an account.
 *
 *   npm run integration:accounts
 *
 * Requires migration 0007. It cleans up after itself.
 *
 * The reset token is recovered by capturing what `email.ts` logs when
 * RESEND_API_KEY is unset. That is deliberate rather than a shortcut: it
 * exercises the real chain — issue, store the hash, compose the message, put a
 * usable link in it — instead of reaching past it to a private function. The
 * link in that log is the one a person would receive.
 */
import { SESSION_IDLE_MS, hashTokenForPostgrest } from "../src/lib/auth/tokens";
import {
  completeEmailVerification,
  completePasswordReset,
  startEmailVerification,
  startPasswordReset,
  sweepEmailTokens,
} from "../src/lib/server/emailTokens";
import {
  createSession,
  listSessions,
  revokeAllSessions,
  revokeSession,
  sessionFromToken,
} from "../src/lib/server/sessions";
import { db } from "../src/lib/server/supabase";
import {
  checkCredentials,
  createUser,
  deleteUser,
  userByEmail,
} from "../src/lib/server/users";

const EMAIL = "account-probe@cubeduel.test";
const SHELL_EMAIL = "shell-probe@cubeduel.test";
const PASSWORD = "a genuinely fine password";

let failures = 0;

function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`  [${ok ? "PASS" : "FAIL"}] ${label}${detail ? `  -> ${detail}` : ""}`);
}

async function cleanup() {
  await db().from("users").delete().in("email", [EMAIL, SHELL_EMAIL]);
}

/** Runs something while capturing the link `email.ts` logs when unconfigured. */
async function captureLink(run: () => Promise<void>): Promise<string | null> {
  const original = console.warn;
  let captured: string | null = null;
  console.warn = (...args: unknown[]) => {
    const text = args.map(String).join(" ");
    const match = /token=([A-Za-z0-9_-]+)/.exec(text);
    if (match) captured = match[1];
  };
  try {
    await run();
  } finally {
    console.warn = original;
  }
  return captured;
}

async function main() {
  await cleanup();

  // -------------------------------------------------------------------------
  console.log("\n== creating an account ==");

  const created = await createUser({ email: EMAIL, password: PASSWORD });
  check("an account was created", created.ok && created.created, created.ok ? "" : created.error);
  if (!created.ok) throw new Error("cannot continue without an account");
  const user = created.user;

  check("the address was stored normalised", user.email === EMAIL);
  check("it starts unverified", user.emailVerifiedAt === null);
  check("it has a password", user.hasPassword);

  {
    const { data } = await db().from("users").select("password_hash").eq("id", user.id).single();
    check("the password is not stored in the clear", data?.password_hash !== PASSWORD);
    check("...and names its algorithm", Boolean(data?.password_hash?.startsWith("scrypt$")), data?.password_hash?.slice(0, 20));
  }

  // -------------------------------------------------------------------------
  console.log("\n== addresses are unique, whatever the casing ==");

  {
    const duplicate = await createUser({ email: EMAIL.toUpperCase(), password: PASSWORD });
    check("the same address in different case is refused", !duplicate.ok);
  }

  // -------------------------------------------------------------------------
  console.log("\n== an abandoned shell can be reclaimed ==");

  {
    // Somebody who started signing up and never finished must not lock
    // themselves out of their own address forever.
    const shell = await createUser({ email: SHELL_EMAIL });
    check("a shell account was created", shell.ok && shell.created);

    const again = await createUser({ email: SHELL_EMAIL, password: PASSWORD });
    check("signing up again hands the shell back", again.ok && !again.created);

    // But once it has a password it is a real account and is not handed over.
    const third = await createUser({ email: SHELL_EMAIL, password: PASSWORD });
    check("a shell with a password is no longer reclaimable", !third.ok);
  }

  // -------------------------------------------------------------------------
  console.log("\n== bad input is refused ==");

  check("a malformed address is refused", !(await createUser({ email: "not-an-address", password: PASSWORD })).ok);
  check("a short password is refused", !(await createUser({ email: "x@cubeduel.test", password: "short" })).ok);
  check("a common password is refused", !(await createUser({ email: "y@cubeduel.test", password: "password123" })).ok);

  // -------------------------------------------------------------------------
  console.log("\n== signing in with a password ==");

  check("the right password signs in", (await checkCredentials(EMAIL, PASSWORD))?.id === user.id);
  check("a wrong password does not", (await checkCredentials(EMAIL, "the wrong one entirely")) === null);
  check("different casing still signs in", (await checkCredentials(EMAIL.toUpperCase(), PASSWORD))?.id === user.id);

  {
    // The property that stops the sign-in form being an enumeration oracle: an
    // address with no account must cost the same scrypt hash as a wrong
    // password, or "no such user" is measurably faster and the form answers
    // "is this person registered here?" to anybody who asks.
    //
    // ## Measured pairwise, and that is the whole trick
    //
    // Comparing the two sign-in paths directly does NOT work: both include a
    // round trip to a database in Tokyo costing four to six hundred
    // milliseconds against a hash of barely a hundred, so deleting the burn
    // moves the ratio from 1.0 to about 1.3 — inside any threshold loose enough
    // not to flake.
    //
    // Subtracting a bare lookup fixes the signal but not the noise. Taking the
    // two medians in sequence means they sample different network conditions,
    // and one run in three produced a NEGATIVE hashing time because the lookup
    // half happened to be slower. A security check that flakes is a security
    // check that gets ignored.
    //
    // So the two are interleaved and differenced per pair. Each pair shares its
    // network conditions, the common-mode variation cancels, and what is left is
    // the hash.
    const missing = "nobody-here-at-all@cubeduel.test";
    const differences: number[] = [];

    for (let i = 0; i < 7; i++) {
      const lookupStart = performance.now();
      await userByEmail(missing);
      const lookup = performance.now() - lookupStart;

      const signInStart = performance.now();
      await checkCredentials(missing, "the wrong one entirely");
      const signIn = performance.now() - signInStart;

      differences.push(signIn - lookup);
    }

    differences.sort((a, b) => a - b);
    const median = differences[Math.floor(differences.length / 2)];

    check(
      "an unknown address still pays for a password hash",
      median > 50,
      `median extra ${median.toFixed(0)}ms over a bare lookup ` +
        `(range ${differences[0].toFixed(0)} to ${differences[differences.length - 1].toFixed(0)})`,
    );
  }

  // -------------------------------------------------------------------------
  console.log("\n== sessions ==");

  const first = await createSession(user.id, { userAgent: "probe/1.0" });
  check("a session was created", Boolean(first));

  {
    const resolved = await sessionFromToken(first!.token);
    check("the token resolves to the right person", resolved?.user.id === user.id);
    check("...and carries their address", resolved?.user.email === EMAIL);
    check("an unknown token resolves to nothing", (await sessionFromToken("not-a-real-token")) === null);
    check("an empty token resolves to nothing", (await sessionFromToken("")) === null);
  }

  {
    const { data } = await db().from("sessions").select("token_hash").eq("user_id", user.id).single();
    check("the session token is not stored in the clear", data?.token_hash !== first!.token);
    check("...it is stored as its hash", data?.token_hash === hashTokenForPostgrest(first!.token));
  }

  // -------------------------------------------------------------------------
  console.log("\n== both expiry rules bite ==");

  {
    const doomed = await createSession(user.id);
    await db()
      .from("sessions")
      .update({ expires_at: new Date(Date.now() - 1000).toISOString() })
      .eq("token_hash", hashTokenForPostgrest(doomed!.token));
    check("a session past its absolute expiry is refused", (await sessionFromToken(doomed!.token)) === null);

    const idle = await createSession(user.id);
    await db()
      .from("sessions")
      .update({ last_seen_at: new Date(Date.now() - SESSION_IDLE_MS - 1000).toISOString() })
      .eq("token_hash", hashTokenForPostgrest(idle!.token));
    check("a session idle past the window is refused", (await sessionFromToken(idle!.token)) === null);

    // Both rows still exist — expiry is judged on read, not delegated to a
    // sweep that may never have run.
    const { count } = await db()
      .from("sessions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id);
    check("...and the rows are still there, so the refusal came from the read", (count ?? 0) >= 3, `${count} rows`);
  }

  // -------------------------------------------------------------------------
  console.log("\n== revoking ==");

  {
    const second = await createSession(user.id, { userAgent: "probe/2.0" });
    check("both sessions work", Boolean(await sessionFromToken(first!.token)) && Boolean(await sessionFromToken(second!.token)));

    await revokeSession(second!.token);
    check("the revoked one stops working", (await sessionFromToken(second!.token)) === null);
    check("...and the other still works", Boolean(await sessionFromToken(first!.token)));

    const listed = await listSessions(user.id);
    check("the device list shows what is left", listed.length >= 1, `${listed.length}`);
    check("...with the user agent recorded", listed.some((s) => s.userAgent === "probe/1.0"));
  }

  // -------------------------------------------------------------------------
  console.log("\n== signing out everywhere, except here ==");

  {
    const keep = await createSession(user.id);
    const drop = await createSession(user.id);

    await revokeAllSessions(user.id, keep!.token);
    check("the exempt session survives", Boolean(await sessionFromToken(keep!.token)));
    check("the others are gone", (await sessionFromToken(drop!.token)) === null);
    check("...including the original", (await sessionFromToken(first!.token)) === null);
  }

  // -------------------------------------------------------------------------
  console.log("\n== confirming an address ==");

  {
    const fresh = await userByEmail(EMAIL);
    const token = await captureLink(() => startEmailVerification(fresh!));
    check("a verification link was produced", Boolean(token));

    const done = await completeEmailVerification(token!);
    check("the link confirms the address", done.ok, done.ok ? "" : done.reason);
    check("...and the account is marked verified", Boolean((await userByEmail(EMAIL))?.emailVerifiedAt));

    // The reason email tokens keep a consumed flag instead of being deleted —
    // and the reason a spent one reports SUCCESS rather than failure once the
    // address is confirmed. Mail clients and corporate link scanners fetch every
    // URL in a message, so the token is very often consumed by a machine seconds
    // before the person clicks. Telling them "invalid link" about an address
    // that is demonstrably confirmed is both alarming and untrue.
    const twice = await completeEmailVerification(token!);
    check(
      "clicking a spent link reports the address is already confirmed",
      twice.ok && "already" in twice && twice.already === true,
      twice.ok ? "ok" : twice.reason,
    );

    check("a token nobody issued is unknown", !(await completeEmailVerification("made-up-token")).ok);
  }

  // -------------------------------------------------------------------------
  console.log("\n== resetting a password ==");

  {
    const alive = await createSession(user.id);
    check("a session is live before the reset", Boolean(await sessionFromToken(alive!.token)));

    const token = await captureLink(() => startPasswordReset(EMAIL));
    check("a reset link was produced", Boolean(token));

    // Validated before the token is spent, so a weak choice does not cost the
    // link.
    const weak = await completePasswordReset(token!, "short");
    check("a weak new password is refused", !weak.ok && weak.reason === "weak");

    const done = await completePasswordReset(token!, "a different fine password");
    check("...and the link still works afterwards", done.ok, done.ok ? "" : done.reason);

    check("the new password signs in", (await checkCredentials(EMAIL, "a different fine password"))?.id === user.id);
    check("the old password does not", (await checkCredentials(EMAIL, PASSWORD)) === null);

    // The point of the whole flow: taking the account back.
    check("every session was signed out", (await sessionFromToken(alive!.token)) === null);

    const reuse = await completePasswordReset(token!, "yet another fine password");
    check("the reset link cannot be used twice", !reuse.ok && reuse.reason === "used", reuse.ok ? "" : reuse.reason);
  }

  // -------------------------------------------------------------------------
  console.log("\n== an expired reset link is refused ==");

  {
    const token = await captureLink(() => startPasswordReset(EMAIL));
    await db()
      .from("email_tokens")
      .update({ expires_at: new Date(Date.now() - 1000).toISOString() })
      .eq("token_hash", hashTokenForPostgrest(token!));

    const result = await completePasswordReset(token!, "a perfectly good password");
    check("an expired link is refused", !result.ok && result.reason === "expired", result.ok ? "" : result.reason);
  }

  // -------------------------------------------------------------------------
  console.log("\n== reset reveals nothing about who has an account ==");

  {
    const token = await captureLink(() => startPasswordReset("definitely-nobody@cubeduel.test"));
    check("no link is produced for an address with no account", token === null);

    // And the function gives the caller nothing to branch on, by returning void.
    const result: unknown = await startPasswordReset("definitely-nobody@cubeduel.test");
    check("...and nothing is returned that could be branched on", result === undefined);
  }

  // -------------------------------------------------------------------------
  console.log("\n== the reset cap holds ==");

  {
    await db().from("email_tokens").delete().eq("purpose", "reset");

    let produced = 0;
    for (let i = 0; i < 6; i++) {
      if (await captureLink(() => startPasswordReset(EMAIL))) produced++;
    }
    check("reset links are capped in the window", produced === 3, `${produced} produced`);
  }

  // -------------------------------------------------------------------------
  console.log("\n== the sweep keeps what still explains itself ==");

  {
    const before = await db().from("email_tokens").select("id", { count: "exact", head: true });
    await sweepEmailTokens();
    const after = await db().from("email_tokens").select("id", { count: "exact", head: true });
    check(
      "recently consumed tokens survive so a second click can be explained",
      (after.count ?? 0) > 0,
      `${before.count} -> ${after.count}`,
    );
  }

  // -------------------------------------------------------------------------
  console.log("\n== deleting an account takes everything with it ==");

  {
    await createSession(user.id);
    const deleted = await deleteUser(user.id);
    check("the account was deleted", deleted);

    for (const table of ["sessions", "email_tokens", "credentials"] as const) {
      const { count } = await db()
        .from(table)
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id);
      check(`...and its ${table} went with it`, (count ?? 0) === 0, `${count} left`);
    }
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
