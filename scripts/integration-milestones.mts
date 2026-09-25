/**
 * Milestones on a profile, against the real database.
 *
 *   npm run integration:milestones
 *
 * What a profile claims about a player has to be exactly what their solves
 * say, and say how sure it is. So: a history longer than one page of rows,
 * with its fastest solve past row 1,000 — the database hands back a thousand
 * at a time, and a reader that stopped there would never see it. A solve the
 * server refused, which must earn nothing however fast it was. And each
 * milestone's proof, told apart: replayed by the server, practice turned on
 * the site, or a stopwatch time.
 *
 * It cleans up after itself.
 */
import { profileMilestones } from "../src/lib/server/profileMilestones";
import { db } from "../src/lib/server/supabase";
import { cleanupProbes, makeProbeProfile } from "./probeAccount.mjs";

let failures = 0;

function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`  [${ok ? "PASS" : "FAIL"}] ${label}${detail ? `  -> ${detail}` : ""}`);
}

const base = Date.parse("2026-01-01T12:00:00Z");

interface Row {
  client_id: string;
  duration_ms: number;
  source: "keyboard" | "smartcube" | "manual";
  mode?: "practice" | "ranked";
  verified?: boolean;
  reject_reason?: string | null;
  event?: string;
  penalty?: "OK" | "PLUS2" | "DNF";
  minute: number;
}

async function insert(profileId: string, rows: Row[]) {
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await db()
      .from("solves")
      .insert(
        rows.slice(i, i + 500).map((r) => ({
          profile_id: profileId,
          client_id: r.client_id,
          event: r.event ?? "333",
          scramble: "R U R' U' F2 L D B' R2 U",
          duration_ms: r.duration_ms,
          penalty: r.penalty ?? "OK",
          source: r.source,
          mode: r.mode ?? "practice",
          verified: r.verified ?? false,
          reject_reason: r.reject_reason ?? null,
          solved_at: new Date(base + r.minute * 60_000).toISOString(),
        })),
      );
    if (error) throw new Error(`insert failed: ${error.message}`);
  }
}

async function idOf(profileId: string, clientId: string): Promise<string> {
  const { data } = await db().from("solves").select("id").eq("profile_id", profileId).eq("client_id", clientId).single();
  return data!.id;
}

async function main() {
  console.log("Milestones on a profile\n");
  const { profile } = await makeProbeProfile("milestones", "probe-milestones", "Probe Milestones");

  // 1,100 keyboard practice solves at 25-26s, then — solve 1,050 — a 14.2.
  const rows: Row[] = Array.from({ length: 1100 }, (_, i) => ({
    client_id: `kb-${i}`,
    duration_ms: 25_000 + (i % 10) * 100,
    source: "keyboard",
    minute: i,
  }));
  rows[1049] = { ...rows[1049], duration_ms: 14_200 };
  // A ranked keyboard solve the server replayed: a 16.8, earlier than all of them.
  rows.push({ client_id: "ranked", duration_ms: 16_800, source: "keyboard", mode: "ranked", verified: true, minute: -10 });
  // Refused by the server: the fastest thing here, and worth nothing.
  rows.push({ client_id: "refused", duration_ms: 5_000, source: "keyboard", mode: "ranked", reject_reason: "does not solve", minute: 2000 });
  // A real cube on a stopwatch: a 2x2 in 9.1, and a 3x3 in 41.
  rows.push({ client_id: "two", duration_ms: 9_100, source: "manual", event: "222", minute: 3000 });
  rows.push({ client_id: "cube", duration_ms: 41_000, source: "manual", minute: 3001 });
  // A DNF'd 12 on a real cube counts for nothing.
  rows.push({ client_id: "dnf", duration_ms: 12_000, source: "manual", penalty: "DNF", minute: 3002 });
  await insert(profile.id, rows);

  const { ladders, proof } = await profileMilestones(profile.id);
  const keys = ladders.map((l) => l.track.key);
  check("one ladder per thing solved, in order", JSON.stringify(keys) === JSON.stringify(["333-cube", "333-keyboard", "222-cube"]), keys.join(","));

  const keyboard = ladders.find((l) => l.track.key === "333-keyboard")!;
  check("every keyboard solve was read, past the first thousand rows", keyboard.solveCount === 1101, String(keyboard.solveCount));
  check("the 14.20 at row 1,050 is the best single", keyboard.best.single === 14_200, String(keyboard.best.single));
  check("the refused 5.00 earned nothing", keyboard.rungs.every((r) => r.single?.resultMs !== 5_000));

  const sub15 = keyboard.rungs.find((r) => r.underMs === 15_000)!.single;
  const sub17 = keyboard.rungs.find((r) => r.underMs === 17_000)!.single;
  check("sub-15 is the 14.20", sub15?.resultMs === 14_200 && sub15.solveId === (await idOf(profile.id, "kb-1049")));
  check("sub-17 went to the ranked 16.80, which came first", sub17?.resultMs === 16_800 && sub17.solveId === (await idOf(profile.id, "ranked")));
  check("the ranked one is verified", proof.get(sub17!.solveId) === "verified", String(proof.get(sub17!.solveId)));
  check("the practice one is practice", proof.get(sub15!.solveId) === "practice", String(proof.get(sub15!.solveId)));

  const cube = ladders.find((l) => l.track.key === "333-cube")!;
  check("the DNF'd 12 is not a sub-15; the 41 is the best", cube.best.single === 41_000, String(cube.best.single));
  const sub45 = cube.rungs.find((r) => r.underMs === 45_000)!.single!;
  check("a stopwatch time says so", proof.get(sub45.solveId) === "self-timed", String(proof.get(sub45.solveId)));

  const two = ladders.find((l) => l.track.key === "222-cube")!;
  check("the 2x2 has its own ladder: sub-10, not sub-7", two.rungs.find((r) => r.underMs === 10_000)!.single !== null && two.rungs.find((r) => r.underMs === 7_000)!.single === null);

  await cleanupProbes();
  console.log(failures === 0 ? "\nAll checks passed." : `\nFAILURES: ${failures}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await cleanupProbes().catch(() => {});
  process.exit(1);
});
