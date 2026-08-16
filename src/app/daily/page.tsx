import type { Metadata } from "next";

import { DailyRound } from "@/components/DailyRound";
import dailies from "@/data/dailies.json";
import { dayNumber, utcDayKey } from "@/lib/daily";

export const metadata: Metadata = {
  title: "Daily scramble — cubeduel",
  description: "One scramble. One attempt. The same cube for everyone, every day.",
};

/**
 * Rendered per request: which day it is changes without the code changing, so a
 * statically prerendered page would serve yesterday's scramble forever.
 */
export const dynamic = "force-dynamic";

export default function DailyPage() {
  const dayKey = utcDayKey();
  const scrambles = dailies.scrambles as Record<string, string>;
  const difficulty = (dailies as { difficulty?: Record<string, { cross: number; faces: string[] }> })
    .difficulty?.[dayKey];

  return (
    <DailyRound
      dayKey={dayKey}
      dayNumber={dayNumber(dailies.start, dayKey)}
      startKey={dailies.start}
      scramble={scrambles[dayKey] ?? null}
      crossMoves={difficulty?.cross ?? null}
    />
  );
}
