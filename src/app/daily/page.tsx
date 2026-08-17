import type { Metadata } from "next";

import { DailyRound } from "@/components/DailyRound";
import dailies from "@/data/dailies.json";
import { dayNumber, utcDayKey } from "@/lib/daily";

export const metadata: Metadata = {
  title: "Daily scramble",
  description: "One scramble. One attempt. The same cube for everyone, every day.",
  // This is the link that gets pasted into group chats, so it carries its own
  // card text rather than inheriting the site-wide one.
  openGraph: {
    title: "cubeduel daily",
    description:
      "One scramble. One attempt. The same cube for everyone, resetting at midnight UTC.",
  },
  twitter: {
    card: "summary_large_image",
    title: "cubeduel daily",
    description:
      "One scramble. One attempt. The same cube for everyone, resetting at midnight UTC.",
  },
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

  // Read, not computed. Solving it here cost five and a half seconds on a cold
  // load, because the first visitor of the day paid for the pruning tables and
  // the search. The dailies are pre-generated so that nothing has to be worked
  // out at request time, and this belongs in the same file for the same reason —
  // see `npm run dailies:annotate`.
  const optimal = (dailies as { optimal?: Record<string, number> }).optimal;
  const optimalMoves = optimal?.[dayKey] ?? null;

  return (
    <DailyRound
      dayKey={dayKey}
      dayNumber={dayNumber(dailies.start, dayKey)}
      startKey={dailies.start}
      scramble={scrambles[dayKey] ?? null}
      crossMoves={difficulty?.cross ?? null}
      optimalMoves={optimalMoves}
    />
  );
}
