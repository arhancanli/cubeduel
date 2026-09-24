"use client";

import { useEffect, useState } from "react";

import { practiceCalendar, type PracticeCalendar as Calendar } from "@/lib/practiceCalendar";
import { loadHistory } from "@/lib/solveHistory";
import { solvingStreak } from "@/lib/streak";

const SHADE = ["bg-surface-hi", "bg-go/30", "bg-go/55", "bg-go/80", "bg-go"] as const;
const WEEKDAYS = ["Mon", "", "Wed", "", "Fri", "", ""];

function dayLabel(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d, 12).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}

/**
 * Six months of practice, a square a day — the streak's longer view. Every
 * puzzle counts: a day at the 5x5 is still a day at the cube.
 */
export function PracticeCalendar() {
  const [data, setData] = useState<{ cal: Calendar; best: number } | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const times = loadHistory().map((s) => s.at);
      setData({ cal: practiceCalendar(times), best: solvingStreak(times).best });
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  if (!data) return <div className="h-52 animate-pulse rounded-2xl bg-surface" />;
  const { cal, best } = data;
  const columns = { gridTemplateColumns: `repeat(${cal.weeks.length}, minmax(0, 1fr))` };

  return (
    <section
      data-testid="practice-calendar"
      className="flex flex-col gap-4 rounded-2xl border border-border bg-surface p-5 sm:p-6"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-lg">The last six months</h2>
        <p className="text-sm text-muted" data-testid="practice-summary">
          {cal.days === 0
            ? "No solves in the last six months yet."
            : `${cal.days} day${cal.days === 1 ? "" : "s"} of practice · ${cal.solves.toLocaleString()} solve${cal.solves === 1 ? "" : "s"} · longest streak ${best} day${best === 1 ? "" : "s"}`}
        </p>
      </div>

      <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2">
        <span aria-hidden="true" />
        <div className="grid gap-[3px] pb-1 text-[10px] text-muted-dim" style={columns} aria-hidden="true">
          {cal.weeks.map((_, i) => (
            <span key={i} className="overflow-visible whitespace-nowrap">
              {cal.months.find((m) => m.week === i)?.label ?? ""}
            </span>
          ))}
        </div>

        <div className="grid grid-rows-7 gap-[3px] text-[10px] leading-none text-muted-dim" aria-hidden="true">
          {WEEKDAYS.map((d, i) => (
            <span key={i} className="flex items-center">
              {d}
            </span>
          ))}
        </div>
        {/* Columns are weeks, Monday at the top — read left to right, oldest first. */}
        <ol className="grid grid-flow-col grid-rows-7 gap-[3px]" style={columns} aria-label="Solves per day, the last six months">
          {cal.weeks.flat().map((day) => (
            <li
              key={day.key}
              aria-label={day.future ? undefined : `${dayLabel(day.key)}: ${day.count} solve${day.count === 1 ? "" : "s"}`}
              aria-hidden={day.future ? true : undefined}
              title={day.future ? undefined : `${dayLabel(day.key)} — ${day.count} solve${day.count === 1 ? "" : "s"}`}
              className={`aspect-square rounded-[3px] ${day.future ? "opacity-0" : SHADE[day.level]} ${
                day.today ? "ring-1 ring-foreground/50" : ""
              }`}
            />
          ))}
        </ol>
      </div>

      <div className="flex items-center justify-end gap-1.5 text-[10px] text-muted-dim" aria-hidden="true">
        Fewer
        {SHADE.map((shade) => (
          <span key={shade} className={`size-2.5 rounded-[2px] ${shade}`} />
        ))}
        More
      </div>
    </section>
  );
}
