/**
 * Following, against the real database.
 *
 *   npm run integration:follows
 *
 * A follow is one row and the feature is two joins, so what can go wrong is
 * mostly about who ends up in them: a stranger in your circle, somebody who
 * follows *you* counted as somebody you follow, a follow that survives an
 * unfollow, a double tap that becomes two rows or an error. And one thing
 * about who can read them: nobody but the server, not even through the two
 * functions.
 *
 * It cleans up after itself.
 */
import { db } from "../src/lib/server/supabase";
import {
  MAX_FOLLOWING,
  followerCount,
  followingBoard,
  followingCount,
  followingDaily,
  isFollowing,
  setFollowing,
} from "../src/lib/server/follows";
import { cleanupProbes, makeProbeProfile } from "./probeAccount.mjs";

let failures = 0;

function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`  [${ok ? "PASS" : "FAIL"}] ${label}${detail ? `  -> ${detail}` : ""}`);
}

async function rate(profileId: string, rating: number | null, deviation: number) {
  const { error } = await db()
    .from("ratings")
    .insert({ profile_id: profileId, event: "333", pool: "keyboard", rating, deviation, solve_count: 20, peak_rating: rating } as never);
  if (error) throw new Error(`rating insert failed: ${error.message}`);
}

async function daily(profileId: string, day: number, durationMs: number, penalty: "OK" | "PLUS2" | "DNF" = "OK") {
  const { error } = await db().from("daily_results").insert({ profile_id: profileId, day, event: "333", duration_ms: durationMs, penalty, verified: true });
  if (error) throw new Error(`daily insert failed: ${error.message}`);
}

async function main() {
  console.log("Following\n");
  const { profile: me } = await makeProbeProfile("follow-me", "probe-follow-me", "Probe Me");
  const { profile: ana } = await makeProbeProfile("follow-ana", "probe-follow-ana", "Probe Ana");
  const { profile: ben } = await makeProbeProfile("follow-ben", "probe-follow-ben", "Probe Ben");
  const { profile: fan } = await makeProbeProfile("follow-fan", "probe-follow-fan", "Probe Fan");
  const { profile: stranger } = await makeProbeProfile("follow-str", "probe-follow-str", "Probe Stranger");

  console.log("== following and unfollowing ==");
  const first = await setFollowing(me.id, "probe-follow-ana", true);
  check("following somebody works and says their count", first.ok && first.following && first.followers === 1, JSON.stringify(first));
  const again = await setFollowing(me.id, "PROBE-FOLLOW-ANA", true);
  check("following them again is not an error and not a second row", again.ok && again.followers === 1, JSON.stringify(again));
  check("a handle is matched however it is typed", again.ok);
  await setFollowing(me.id, "probe-follow-ben", true);
  await setFollowing(fan.id, "probe-follow-me", true);
  check("counts: I follow two, one follows me", (await followingCount(me.id)) === 2 && (await followerCount(me.id)) === 1);

  const self = await setFollowing(me.id, "probe-follow-me", true);
  check("you cannot follow yourself", !self.ok && self.status === 400, JSON.stringify(self));
  const nobody = await setFollowing(me.id, "probe-nobody-here", true);
  check("an unknown handle is a 404, not a crash", !nobody.ok && nobody.status === 404);

  const selfRow = await db().from("follows").insert({ follower_id: me.id, followee_id: me.id });
  check("the database refuses a self-follow on its own too", selfRow.error !== null);

  const off = await setFollowing(me.id, "probe-follow-ben", false);
  check("unfollowing works", off.ok && !off.following && !(await isFollowing(me.id, ben.id)));
  const offAgain = await setFollowing(me.id, "probe-follow-ben", false);
  check("unfollowing twice is not an error", offAgain.ok);
  await setFollowing(me.id, "probe-follow-ben", true);

  console.log("\n== the circle on the leaderboard ==");
  await rate(me.id, 1500, 60);
  await rate(ana.id, 1800, 40);
  await rate(ben.id, 1650, 150);
  await rate(fan.id, 2500, 40);
  await rate(stranger.id, 2900, 40);
  const board = await followingBoard(me.id);
  const handles = board.map((e) => e.handle);
  check("me and the two I follow, best first", JSON.stringify(handles) === JSON.stringify(["probe-follow-ana", "probe-follow-ben", "probe-follow-me"]), handles.join(","));
  check("somebody who follows me is not in my circle", !handles.includes("probe-follow-fan"));
  check("a stranger is not in it", !handles.includes("probe-follow-str"));
  check("I am marked as me", board.find((e) => e.isYou)?.handle === "probe-follow-me");
  check("a ±150 rating is shown but marked provisional", board.find((e) => e.handle === "probe-follow-ben")?.established === false);
  check("a ±40 rating is established", board.find((e) => e.handle === "probe-follow-ana")?.established === true);

  const { profile: fresh } = await makeProbeProfile("follow-new", "probe-follow-new", "Probe New");
  await setFollowing(me.id, "probe-follow-new", true);
  const withUnrated = await followingBoard(me.id);
  check("somebody with no rating is listed last, not left out",
    withUnrated[withUnrated.length - 1].handle === "probe-follow-new" && withUnrated[withUnrated.length - 1].rating === null);
  void fresh;

  console.log("\n== today's daily among them ==");
  const day = 9000;
  await daily(me.id, day, 21_000);
  await daily(ana.id, day, 18_000, "PLUS2");
  await daily(ben.id, day, 12_000, "DNF");
  await daily(fan.id, day, 9_000);
  await daily(stranger.id, day, 8_000);
  await daily(ana.id, day + 1, 5_000);
  const today = await followingDaily(me.id, day);
  check("only the circle, only that day: Ana's 20.00 (+2), my 21.00, Ben's DNF",
    JSON.stringify(today.map((r) => r.handle)) === JSON.stringify(["probe-follow-ana", "probe-follow-me", "probe-follow-ben"]),
    today.map((r) => `${r.handle}:${r.penalty}`).join(","));

  console.log("\n== nobody else can read it ==");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const table = await fetch(`${url}/rest/v1/follows?select=follower_id`);
  const rows = table.ok ? ((await table.json()) as unknown[]).length : 0;
  check("an anonymous request reads no follows", rows === 0, `${table.status}, ${rows} rows`);
  for (const [fn, body] of [
    ["circle_board", { p_profile: me.id }],
    ["circle_daily", { p_profile: me.id, p_day: day }],
  ] as const) {
    const call = await fetch(`${url}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await call.text();
    check(`an anonymous request cannot call ${fn}`, !call.ok && !text.includes("probe-follow"), `${call.status}`);
  }

  console.log("\n== a limit ==");
  const { profile: collector } = await makeProbeProfile("follow-col", "probe-follow-col", "Probe Collector");
  // Five hundred profiles to follow, inserted directly: five hundred sign-ups
  // would test the sign-up, not the cap. No account behind them, so they are
  // removed by handle at the end rather than by the probe cleanup.
  const { data: crowd, error: crowdError } = await db()
    .from("profiles")
    .insert(Array.from({ length: MAX_FOLLOWING }, (_, i) => ({ handle: `probe-cap-${i}`, display_name: `Cap ${i}` })))
    .select("id");
  if (crowdError || !crowd) throw new Error(`crowd insert failed: ${crowdError?.message}`);
  try {
    await db().from("follows").insert(crowd.slice(0, MAX_FOLLOWING - 1).map((r) => ({ follower_id: collector.id, followee_id: r.id })));
    const last = await setFollowing(collector.id, `probe-cap-${MAX_FOLLOWING - 1}`, true);
    check(`the ${MAX_FOLLOWING}th follow goes through`, last.ok, JSON.stringify(last));
    const over = await setFollowing(collector.id, "probe-follow-me", true);
    check(`the ${MAX_FOLLOWING + 1}st is refused with a reason`, !over.ok && over.status === 409 && over.error.includes(String(MAX_FOLLOWING)), JSON.stringify(over));
    const already = await setFollowing(collector.id, "probe-cap-0", true);
    check("at the limit, re-following somebody you already follow is still fine", already.ok, JSON.stringify(already));
    const board = await followingBoard(collector.id);
    check("a circle of 501 comes back whole from one call", board.length === MAX_FOLLOWING + 1, String(board.length));
  } finally {
    await db().from("profiles").delete().like("handle", "probe-cap-%");
  }

  await cleanupProbes();
  console.log(failures === 0 ? "\nAll checks passed." : `\nFAILURES: ${failures}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await cleanupProbes().catch(() => {});
  process.exit(1);
});
