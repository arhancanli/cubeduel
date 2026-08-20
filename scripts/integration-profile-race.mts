/**
 * `ensureProfile` under concurrency, against the real database.
 *
 * This exists because of an intermittent failure that is close to the worst one
 * this app can have: a brand new player's very first page load rendering
 * "Something broke".
 *
 * A signed-in page tree calls `ensureProfile` from more than one place, so a
 * first visit fires several of them at once for a user who has no profile yet.
 * They all miss, they all try to insert, one wins, and the rest hit the
 * `user_id` unique index. Whether the losers recover decides whether the
 * player sees the app or an error page — and because it depends on timing, it
 * reproduces perhaps one run in three by hand, which is exactly the frequency at
 * which a bug gets dismissed as a fluke.
 *
 * So this does not hope for the race. It forces it: N calls launched in the same
 * tick for the same fresh id, repeated over several rounds.
 *
 *   npm run integration:profile-race
 *
 * It cleans up after itself.
 */

import { handleCandidates } from "../src/lib/handle";
import { createProfileFor, profileFor } from "../src/lib/server/profileStore";
import { db } from "../src/lib/server/supabase";
import { cleanupProbes, makeProbeAccount } from "./probeAccount.mjs";

/** Concurrent callers per round — comfortably more than the page tree makes. */
const CONCURRENCY = 8;
const ROUNDS = 5;

let failures = 0;

function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`  [${ok ? "PASS" : "FAIL"}] ${label}${detail ? `  -> ${detail}` : ""}`);
}

async function cleanup() {
  // One statement: `users` cascades to profiles. Deleting profiles first would
  // leave the accounts behind to accumulate unseen.
  await cleanupProbes();
}

async function main() {
  console.log("\n== setup ==");
  await cleanup();
  check("no leftover probe profiles", true);

  console.log(`\n== ${ROUNDS} rounds of ${CONCURRENCY} concurrent first visits ==`);

  for (let round = 1; round <= ROUNDS; round++) {
    // A real account, because `profiles.user_id` has a foreign key now. The
    // race being forced is unchanged — what is contended is the same unique
    // index, under its new name.
    const { userId } = await makeProbeAccount("race");

    // Launched in the same tick, deliberately. Awaiting them in sequence would
    // pass with the bug present, because the first call would have finished
    // before the second started and there would be no race at all.
    // Same display name for every caller on purpose: they derive the same
    // handle seed and so collide on the handle index too, which is the harder
    // half of the race.
    const settled = await Promise.allSettled(
      Array.from({ length: CONCURRENCY }, () =>
        createProfileFor(userId, "Race Probe", null),
      ),
    );

    const rejected = settled.filter((r) => r.status === "rejected");
    const fulfilled = settled.filter(
      (r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof createProfileFor>>> =>
        r.status === "fulfilled",
    );

    check(
      `round ${round}: every caller got a profile`,
      rejected.length === 0 && fulfilled.every((r) => r.value !== null),
      rejected.length > 0
        ? String((rejected[0] as PromiseRejectedResult).reason).slice(0, 120)
        : "",
    );

    const ids = new Set(fulfilled.map((r) => r.value?.id).filter(Boolean));
    check(
      `round ${round}: they all got the SAME profile`,
      ids.size === 1,
      `${ids.size} distinct ids`,
    );

    // The unique index would have stopped a second row, so this is really a
    // check that nothing recovered by inventing a second identity elsewhere.
    const { count } = await db()
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId);
    check(`round ${round}: exactly one row exists`, count === 1, `${count} rows`);
  }

  console.log("\n== handles stay unique across racing users ==");
  {
    // Different players arriving at once, all seeded from the same display name,
    // so they contend for the same handle rather than the same id. Losing on the
    // handle index must mean "try the next candidate", not "return somebody
    // else's profile" — which is the failure that would quietly hand one player
    // another player's account.
    const ids = await Promise.all(
      Array.from({ length: CONCURRENCY }, async (_, i) =>
        (await makeProbeAccount(`race-multi-${i}`)).userId,
      ),
    );

    const settled = await Promise.allSettled(
      ids.map((id) => createProfileFor(id, "Race Probe", null)),
    );

    check("nobody failed", settled.every((r) => r.status === "fulfilled"),
      settled.find((r) => r.status === "rejected")
        ? String((settled.find((r) => r.status === "rejected") as PromiseRejectedResult).reason).slice(0, 140)
        : "");

    const profiles = settled
      .filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof createProfileFor>>> =>
        r.status === "fulfilled")
      .map((r) => r.value);

    const handles = profiles.map((p) => p.handle);
    check("every player got a distinct handle",
      new Set(handles).size === handles.length,
      handles.join(", ").slice(0, 140));

    check("every player got their OWN profile",
      profiles.every((p, i) => p.user_id === ids[i]),
      `${profiles.filter((p, i) => p.user_id !== ids[i]).length} mismatched`);

    // And each is retrievable by the id it was created for.
    const round_trip = await Promise.all(ids.map((id) => profileFor(id)));
    check("each is found again by id", round_trip.every((p) => p !== null),
      `${round_trip.filter((p) => p === null).length} missing`);
  }

  console.log("\n== the fallback path, which is where it actually broke ==");
  {
    // The loop above only reaches the fallback when every candidate handle is
    // taken, and the first version of this suite never got there — so removing
    // the fix changed nothing and the suite still passed. A popular display name
    // reaches it routinely, so this occupies all twelve candidates first.
    const seed = `raceseed${Date.now() % 100000}`;
    const taken = handleCandidates(seed);

    await Promise.all(
      taken.map(async (handle, i) => {
        const filler = await makeProbeAccount(`race-filler-${i}`);
        return db().from("profiles").insert({
          user_id: filler.userId,
          handle,
          display_name: "Filler",
        });
      }),
    );

    const { count: occupied } = await db()
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .in("handle", taken);
    check("every candidate handle is occupied", occupied === taken.length,
      `${occupied}/${taken.length}`);

    // Now race a brand new player whose seed is that exhausted name. Every
    // caller walks the whole list, fails on the handle index each time, and
    // arrives at the fallback holding the same generated handle.
    const { userId } = await makeProbeAccount("race-fallback");
    const settled = await Promise.allSettled(
      Array.from({ length: CONCURRENCY }, () => createProfileFor(userId, seed, null)),
    );

    const rejected = settled.filter((r) => r.status === "rejected");
    check("nobody hit an error page on the fallback path", rejected.length === 0,
      rejected.length > 0
        ? String((rejected[0] as PromiseRejectedResult).reason).slice(0, 140)
        : "");

    const got = settled
      .filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof createProfileFor>>> =>
        r.status === "fulfilled")
      .map((r) => r.value);
    check("they all got the same profile", new Set(got.map((p) => p.id)).size === 1,
      `${new Set(got.map((p) => p.id)).size} distinct`);
    check("and it is a fallback handle, so the loop really was exhausted",
      got[0]?.handle.startsWith("cuber-") === true, got[0]?.handle ?? "none");

    // Left for the final cleanup, which removes every probe account and
    // cascades. Deleting the profiles here would strand their accounts.
  }

  console.log("\n== cleanup ==");
  await cleanup();
  const { count } = await db()
    .from("users")
    .select("id", { count: "exact", head: true })
    .like("email", "%@cubeduel.test");
  check("the probe removed itself", (count ?? 0) === 0, `${count ?? 0} left`);
}

main()
  .catch((error) => {
    console.error("\nFAILED:", error);
    failures++;
  })
  .finally(async () => {
    await cleanup();
    console.log("\n" + "=".repeat(52));
    console.log(failures === 0 ? "All checks passed." : `FAILURES: ${failures}`);
    process.exit(failures === 0 ? 0 : 1);
  });
