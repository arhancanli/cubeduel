"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { loadHistory } from "@/lib/solveHistory";
import { solvingStreak, type Streak } from "@/lib/streak";

/**
 * Days in a row with at least one solve, and the last fortnight as a strip of
 * stickers — lit where you solved. Read from this device's history, so it
 * works signed out.
 *
 * The line under the number is the only nudge, and it is a plain one: if today
 * is not in yet it says so, and says the streak is safe until the day ends.
 */
export function StreakCard({ compact = false }: { compact?: boolean }) {
  const [streak, setStreak] = useState<Streak | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setStreak(solvingStreak(loadHistory().map((s) => s.at)));
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  if (!streak) return <div className={`${compact ? "h-24" : "h-36"} animate-pulse rounded-2xl bg-surface`} />;

  const line =
    streak.current === 0
      ? "Solve today to start one."
      : streak.today
        ? `Today counts. Best ${streak.best} day${streak.best === 1 ? "" : "s"}.`
        : "Solve today to keep it — it's safe until midnight.";

  return (
    <section
      data-testid="streak"
      className="flex flex-col gap-4 rounded-2xl border border-border bg-surface p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6"
    >
      <div className="flex flex-col gap-1">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-dim">Solving streak</p>
        <p className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl">
          <span className="tnum">{streak.current}</span> day{streak.current === 1 ? "" : "s"}
        </p>
        <p className="text-sm text-muted">{line}</p>
      </div>
      <div className="flex flex-col gap-2 sm:items-end">
        <ol aria-label="The last fourteen days" className="grid grid-cols-14 gap-1 p-1">
          {streak.recent.map((solved, i) => {
            const isToday = i === streak.recent.length - 1;
            return (
              <li
                key={i}
                aria-label={`${isToday ? "Today" : `${streak.recent.length - 1 - i} days ago`}: ${solved ? "solved" : "no solve"}`}
                className={`size-4 rounded-[4px] sm:size-5 ${solved ? "bg-go" : "bg-surface-hi"} ${
                  isToday ? "ring-2 ring-foreground/40 ring-offset-2 ring-offset-surface" : ""
                }`}
              />
            );
          })}
        </ol>
        {!streak.today && !compact ? (
          <Link href="/play" className="btn-go self-start px-4 py-2 text-sm sm:self-end">
            Solve now
          </Link>
        ) : null}
      </div>
    </section>
  );
}
