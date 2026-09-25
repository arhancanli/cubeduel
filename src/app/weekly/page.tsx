import type { Metadata } from "next";

import { ModeGate } from "@/components/ModeGate";
import { WeeklyScreen } from "@/components/WeeklyScreen";
import { ensureProfile } from "@/lib/server/profiles";
import { isDatabaseConfigured } from "@/lib/server/supabase";
import { pastWeeks, standing, weeklyBoard } from "@/lib/server/weekly";
import { weekEnd, weekKey, weekLabel } from "@/lib/weekly";

export const metadata: Metadata = {
  title: "Weekly competition",
  description:
    "Five scrambles, the same for everyone, one attempt at each, ranked by the average of five. Every solve checked by the server. A new round every Monday.",
};

/** Which week it is changes without the code changing. */
export const dynamic = "force-dynamic";

export default async function WeeklyPage() {
  if (!isDatabaseConfigured()) {
    return (
      <ModeGate face="ranked" active="weekly" title="The weekly is not available right now.">
        It needs its database, which is not configured for this deployment. Practice, the daily and your progress all
        still work.
      </ModeGate>
    );
  }

  const week = weekKey(Date.now());
  const profile = await ensureProfile();
  const [board, mine, past] = await Promise.all([
    weeklyBoard(week),
    profile ? standing(profile.id, week, "keyboard") : Promise.resolve(null),
    pastWeeks(week, 1),
  ]);

  return (
    <WeeklyScreen
      week={week}
      label={weekLabel(week)}
      closesAt={weekEnd(week)}
      signedIn={profile !== null}
      you={profile?.handle ?? null}
      results={(mine?.results ?? []).map(({ idx, durationMs, penalty }) => ({ idx, durationMs, penalty }))}
      leftOpen={mine?.open?.idx ?? null}
      placed={board.placed}
      competing={board.competing}
      lastWeek={past[0] ?? null}
    />
  );
}
