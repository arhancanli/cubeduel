/**
 * The WCA link, against the real database.
 *
 *   npm run integration:wca
 *
 * The OAuth exchange itself needs credentials this deployment may not have, so
 * what is checked here is everything around it — and that is where the damage
 * would be. A WCA id is public: every one of them is on
 * worldcubeassociation.org. So the only thing standing between an honest link
 * and somebody attaching a world-class competition average to their own profile
 * is that the state is issued by this server, redeemed once, and belongs to the
 * profile that started the flow.
 *
 * It cleans up after itself.
 */
import { hashTokenForPostgrest, newToken } from "../src/lib/auth/tokens";
import { db } from "../src/lib/server/supabase";
import { beginWcaLink, linkFor, sweepWcaStates, unlinkWca, wcaConfigured } from "../src/lib/server/wca";
import { cleanupProbes, makeProbeProfile } from "./probeAccount.mjs";

let failures = 0;

function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`  [${ok ? "PASS" : "FAIL"}] ${label}${detail ? `  -> ${detail}` : ""}`);
}

async function cleanup() {
  await cleanupProbes();
}

/** Redeems a state the way the callback does, so the race is the real one. */
async function consume(state: string): Promise<string | null> {
  const { data, error } = await db()
    .from("wca_oauth_states")
    .delete()
    .eq("state_hash", hashTokenForPostgrest(state))
    .select("profile_id, expires_at")
    .maybeSingle();
  if (error || !data) return null;
  if (Date.now() >= new Date(data.expires_at).getTime()) return null;
  return data.profile_id;
}

async function main() {
  console.log("\n== setup ==");
  await cleanup();

  const alice = await makeProbeProfile("wca-a", `wcaa-${Date.now().toString(36)}`, "Alice");
  const bob = await makeProbeProfile("wca-b", `wcab-${Date.now().toString(36)}`, "Bob");
  check("two probe profiles exist", Boolean(alice && bob));
  console.log(`  WCA OAuth configured on this deployment: ${wcaConfigured()}`);

  // -------------------------------------------------------------------------
  console.log("\n== there is no way to link without proving it ==");

  {
    // The property the whole feature rests on: nothing anywhere accepts a typed
    // WCA id. Asserted against the module's own surface, because a future
    // "just let them type it" helper is exactly the change that would quietly
    // undo this.
    const exports = await import("../src/lib/server/wca");
    const names = Object.keys(exports);
    const claimish = names.filter((n) => /claim|setWcaId|linkById|attach/i.test(n));
    check("no function takes a WCA id and links it", claimish.length === 0, claimish.join(", "));
  }

  // -------------------------------------------------------------------------
  console.log("\n== the OAuth state ==");

  if (wcaConfigured()) {
    const url = await beginWcaLink(alice.profile.id);
    check("a flow can be started", Boolean(url));
    check("...and it goes to the WCA", url?.startsWith("https://www.worldcubeassociation.org/oauth/authorize") ?? false);
    check("...asking only for the public scope", url?.includes("scope=public") ?? false, url ?? "");
  } else {
    check("starting a flow is refused with no credentials", (await beginWcaLink(alice.profile.id)) === null);
    console.log("  (the checks below exercise the state table directly)");
  }

  {
    // Inserted directly, so the state machine is exercised whether or not this
    // deployment has credentials — the refusal above must not mean the rest of
    // this suite silently tests nothing.
    const state = newToken();
    await db().from("wca_oauth_states").insert({
      state_hash: hashTokenForPostgrest(state),
      profile_id: alice.profile.id,
      expires_at: new Date(Date.now() + 600_000).toISOString(),
    });

    check("a state redeems to the profile that started it", (await consume(state)) === alice.profile.id);
    check("...and only once", (await consume(state)) === null);
  }

  {
    const state = newToken();
    await db().from("wca_oauth_states").insert({
      state_hash: hashTokenForPostgrest(state),
      profile_id: alice.profile.id,
      expires_at: new Date(Date.now() + 600_000).toISOString(),
    });

    const [one, two] = await Promise.all([consume(state), consume(state)]);
    check("two requests racing one callback: exactly one wins",
      [one, two].filter(Boolean).length === 1);
  }

  {
    const state = newToken();
    await db().from("wca_oauth_states").insert({
      state_hash: hashTokenForPostgrest(state),
      profile_id: alice.profile.id,
      expires_at: new Date(Date.now() - 1000).toISOString(),
    });
    check("an expired state is refused", (await consume(state)) === null);
  }

  // -------------------------------------------------------------------------
  console.log("\n== a link belongs to exactly one account ==");

  await db().from("wca_links").insert({
    profile_id: alice.profile.id,
    wca_id: "2003BRUC01",
    name: "Ron van Bruchem",
    country: "Netherlands",
    competitions: 277,
    records: { "333": { singleMs: 7660, averageMs: 11910, worldRank: 1, countryRank: 1 } } as never,
    refreshed_at: new Date().toISOString(),
  });

  const alicesLink = await linkFor(alice.profile.id);
  check("the link reads back", alicesLink?.wcaId === "2003BRUC01");
  check("...with its cached records", alicesLink?.records["333"] !== undefined);
  check("...and a verification timestamp", Boolean(alicesLink?.verifiedAt));

  {
    // Both cannot be the same competitor. Whoever proved it first keeps it —
    // otherwise a competition record silently moves from one profile to another.
    const { error } = await db().from("wca_links").insert({
      profile_id: bob.profile.id,
      wca_id: "2003BRUC01",
    });
    check("a second account cannot claim the same competitor", error?.code === "23505",
      error?.code ?? "no error");
  }

  {
    const { error } = await db().from("wca_links").insert({
      profile_id: bob.profile.id,
      wca_id: "not-an-id",
    });
    check("a malformed WCA id is refused by the database too", Boolean(error),
      error?.code ?? "accepted");
  }

  check("somebody with no link reads as null", (await linkFor(bob.profile.id)) === null);

  // -------------------------------------------------------------------------
  console.log("\n== unlinking ==");

  check("a link can be removed", await unlinkWca(alice.profile.id));
  check("...and is gone", (await linkFor(alice.profile.id)) === null);

  {
    // Freed, so somebody who unlinks and re-proves is not locked out of their
    // own competition record.
    const { error } = await db().from("wca_links").insert({
      profile_id: bob.profile.id,
      wca_id: "2003BRUC01",
    });
    check("...freeing the id for whoever proves it next", !error, error?.message ?? "");
  }

  // -------------------------------------------------------------------------
  console.log("\n== the sweep ==");

  {
    const stale = newToken();
    await db().from("wca_oauth_states").insert({
      state_hash: hashTokenForPostgrest(stale),
      profile_id: alice.profile.id,
      expires_at: new Date(Date.now() - 86_400_000).toISOString(),
    });
    const live = newToken();
    await db().from("wca_oauth_states").insert({
      state_hash: hashTokenForPostgrest(live),
      profile_id: alice.profile.id,
      expires_at: new Date(Date.now() + 600_000).toISOString(),
    });

    const removed = await sweepWcaStates();
    check("the sweep removes expired states", removed >= 1, `${removed} removed`);
    check("...and leaves live ones alone", (await consume(live)) === alice.profile.id);
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
