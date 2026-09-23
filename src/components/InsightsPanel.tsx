"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import type { TimedMove } from "@/lib/cfop";
import { formatMs } from "@/lib/format";
import { MIN_REVIEWED, insightsFrom, type Habit, type Insights } from "@/lib/habits";
import { studySolve } from "@/lib/solveStudy";

/** How many recent solves are read. Enough for a habit, few enough to be current. */
export const INSIGHT_WINDOW = 25;

export interface InsightSolve {
  /** Where its own review lives. */
  href: string;
  scramble: string;
  moves: TimedMove[];
  durationMs: number;
}

/**
 * Habits across recent solves: the single-solve review, rolled up.
 *
 * Every solve is re-read in the browser the same way its own review reads it,
 * newest first, and the page shows how far through it is — the first solve
 * loads the puzzle engine and takes a second or so, the rest a few
 * milliseconds each.
 */
export function InsightsPanel({ solves }: { solves: InsightSolve[] }) {
  const recent = solves.slice(0, INSIGHT_WINDOW);
  const [read, setRead] = useState(0);
  const [insights, setInsights] = useState<Insights | null>(null);
  const [links, setLinks] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const reviewed = [];
      const hrefs: string[] = [];
      for (const solve of recent) {
        try {
          const study = await studySolve(solve.scramble, solve.moves, solve.durationMs);
          reviewed.push({ durationMs: solve.durationMs, review: study.review });
          hrefs.push(solve.href);
        } catch {
          // A solve that cannot be read back is left out, not guessed at.
        }
        if (cancelled) return;
        setRead((n) => n + 1);
      }
      if (!cancelled) {
        setInsights(insightsFrom(reviewed));
        setLinks(hrefs);
      }
    })();
    return () => {
      cancelled = true;
    };
    // `recent` is derived from `solves`; re-reading on every render would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [solves]);

  return (
    <section aria-labelledby="insights-heading" className="flex flex-col gap-5" data-testid="insights">
      <div className="flex flex-col gap-1">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-sticker-green">Insights</p>
        <h2 id="insights-heading" className="text-3xl">
          {insights?.kind === "insights"
            ? `Across your last ${insights.solves} solves`
            : "Your habits, from your turns"}
        </h2>
      </div>

      {!insights ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          <p className="text-sm text-muted-dim">
            Reading {Math.min(read + 1, recent.length)} of {recent.length} solves…
          </p>
          <div className="h-1.5 overflow-hidden rounded-full bg-surface-hi">
            <div
              className="h-full rounded-full bg-go transition-[width] duration-200"
              style={{ width: `${recent.length ? (read / recent.length) * 100 : 0}%` }}
            />
          </div>
        </div>
      ) : insights.kind === "insufficient" ? (
        <p className="rounded-2xl border border-dashed border-border px-5 py-5 text-sm leading-relaxed text-muted">
          {insights.solves === 0 ? "No solves with turns yet." : `${insights.solves} solve${insights.solves === 1 ? "" : "s"} with turns so far.`}{" "}
          A habit only shows across solves — after {MIN_REVIEWED} this becomes a list of what costs you
          the most, and what to do about it.
        </p>
      ) : (
        <Found insights={insights} links={links} />
      )}
    </section>
  );
}

function Found({ insights, links }: { insights: Extract<Insights, { kind: "insights" }>; links: string[] }) {
  const share = insights.meanDurationMs > 0 ? insights.recoverablePerSolveMs / insights.meanDurationMs : 0;
  const [first, ...rest] = insights.habits;
  return (
    <>
      <dl className="grid grid-cols-2 gap-2 sm:max-w-md">
        <Tile label="Mean time" value={formatMs(insights.meanDurationMs, { truncate: false })} />
        <Tile
          label="Recoverable"
          value={`~${formatMs(insights.recoverablePerSolveMs, { truncate: false })}`}
          note={`a solve · ${Math.round(share * 100)}%`}
        />
      </dl>

      {first ? (
        <article
          data-testid="habit-first"
          className="relative overflow-hidden rounded-3xl border border-border bg-surface p-6 sm:p-7"
        >
          <span aria-hidden="true" className="absolute inset-x-0 top-0 h-1.5 bg-go" />
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-dim">Fix this first</p>
          <h3 className="mt-2 text-2xl leading-tight sm:text-[1.75rem]">{first.title}</h3>
          <p className="mt-2 text-sm text-muted">{first.evidence}</p>
          <p className="mt-4 max-w-2xl text-base leading-relaxed">{first.advice}</p>
          <div className="mt-5 flex flex-wrap items-center gap-4">
            {first.href && first.action ? (
              <Link href={first.href} className="btn-go px-5 py-2.5 text-sm">
                {first.action}
              </Link>
            ) : null}
            {links[first.worst] ? (
              <Link
                href={links[first.worst]}
                className={`${first.href && first.action ? "btn-secondary" : "btn-go"} px-5 py-2.5 text-sm`}
              >
                Watch the worst one
              </Link>
            ) : null}
            <span className="tnum text-sm text-muted-dim">
              about {formatMs(first.perSolveMs, { truncate: false })} a solve · in{" "}
              {Math.round(first.share * 100)}% of solves
            </span>
          </div>
        </article>
      ) : (
        <p className="rounded-2xl border border-border bg-surface px-5 py-5 text-sm leading-relaxed text-muted">
          No habit costs you more than a tenth of a second a solve. What is left is speed, and speed
          comes from volume.
        </p>
      )}

      {rest.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {rest.map((habit) => (
            <HabitRow
              key={habit.kind}
              habit={habit}
              worst={first?.perSolveMs ?? habit.perSolveMs}
              example={links[habit.worst]}
            />
          ))}
        </ul>
      ) : null}
    </>
  );
}

function HabitRow({ habit, worst, example }: { habit: Habit; worst: number; example?: string }) {
  return (
    <li className="flex flex-col gap-2 rounded-2xl border border-border bg-surface p-4">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[15px] font-semibold">{habit.title}</p>
        <span className="tnum shrink-0 text-sm font-semibold text-holding">
          −{formatMs(habit.perSolveMs, { truncate: false })}
        </span>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-surface-hi" aria-hidden="true">
        <div className="h-full rounded-full bg-holding/80" style={{ width: `${Math.max(4, (habit.perSolveMs / worst) * 100)}%` }} />
      </div>
      <p className="text-sm text-muted">{habit.evidence}</p>
      <p className="text-sm leading-relaxed text-muted-dim">{habit.advice}</p>
      <div className="flex flex-wrap gap-x-5 gap-y-1">
        {habit.href && habit.action ? (
          <Link href={habit.href} className="text-sm font-semibold text-sticker-green hover:underline">
            {habit.action} →
          </Link>
        ) : null}
        {example ? (
          <Link href={example} className="text-sm font-semibold text-foreground hover:underline">
            Watch the worst one →
          </Link>
        ) : null}
      </div>
    </li>
  );
}

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface px-3.5 py-3">
      <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-dim">{label}</dt>
      <dd className="tnum mt-1 font-display text-xl font-bold">{value}</dd>
      {note ? <dd className="mt-0.5 text-[11px] text-muted-dim">{note}</dd> : null}
    </div>
  );
}
