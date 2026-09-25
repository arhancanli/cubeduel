"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { CaseCoach } from "@/components/CaseCoach";
import { CsTimerImport } from "@/components/CsTimerImport";
import { GoalPanel } from "@/components/GoalPanel";
import { MilestonesCard } from "@/components/MilestonesCard";
import { PageHero } from "@/components/PageHero";
import { SiteHeader } from "@/components/SiteHeader";
import { PracticeCalendar } from "@/components/PracticeCalendar";
import { StreakCard } from "@/components/StreakCard";
import { formatMs } from "@/lib/format";
import {
  aggregatePhases,
  diagnose,
  lookAndTurn,
  totalTimeTrend,
  type Diagnosis,
  type LookTurn,
  type PhaseAggregate,
  type Trend,
} from "@/lib/phaseStats";
import { loadHistory, type StoredSolve } from "@/lib/solveHistory";

/**
 * What to practise next.
 *
 * The page is deliberately built around one recommendation rather than a wall of
 * numbers. A cuber who reads twelve statistics and changes nothing has been given
 * nothing; the job is to name a single phase and say why.
 *
 * Measured facts and interpretation are visually separated throughout, so it is
 * always obvious which parts are arithmetic and which are a judgement that could be
 * wrong.
 */
export function ProgressScreen() {
  const [solves, setSolves] = useState<StoredSolve[] | null>(null);

  useEffect(() => {
    setSolves(loadHistory("333"));
  }, []);

  if (solves === null) {
    return <Shell>{null}</Shell>;
  }

  const aggregates = aggregatePhases(solves);
  const diagnosis = diagnose(solves);
  const looking = lookAndTurn(solves);
  const trend = totalTimeTrend(solves);

  const reload = () => setSolves(loadHistory("333"));

  // One layout for both states, with the importer in the same place in each.
  // Importing into an empty history turns this page from the empty state into
  // the full one; if the importer lived in two different trees it would be
  // unmounted at exactly that moment, taking its "Added 2,000 solves" with it.
  return (
    <Shell titled={solves.length > 0}>
      <div className="flex w-full flex-col gap-4">
        {solves.length === 0 ? (
          <>
            <EmptyProgress />
            {/* Somebody who only times a 4x4 has no 3x3 analysis, but has a ladder. */}
            <MilestonesCard />
          </>
        ) : (
          <>
            {/* Your numbers first: they are what somebody opening this page
                came to see, and they used to be at the very bottom. */}
            <Card>
              <Overview solves={solves} trend={trend} />
            </Card>
            <MilestonesCard />
            <StreakCard />
            <PracticeCalendar />
            <Card>
              <Recommendation diagnosis={diagnosis} />
            </Card>
            {/* The tables below say which phase is slow; the review says why,
                from the turns. One line, because it is a different page. */}
            {solves.some((solve) => solve.moves) ? (
              <Link
                href="/review"
                className="group flex items-center justify-between gap-4 rounded-2xl border border-border bg-surface px-5 py-4 transition-colors hover:border-muted-dim/60"
              >
                <span className="flex flex-col gap-0.5">
                  <span className="text-[15px] font-semibold">Insights from your turns</span>
                  <span className="text-sm text-muted">
                    The habits costing you the most, and each solve read back move by move.
                  </span>
                </span>
                <span aria-hidden="true" className="text-lg transition-transform group-hover:translate-x-0.5">
                  →
                </span>
              </Link>
            ) : null}
            {aggregates.length > 0 ? (
              <Card>
                <PhaseTable aggregates={aggregates} />
              </Card>
            ) : null}
            {aggregates.length > 0 ? (
              <Card>
                <LookTurnTable rows={looking} />
              </Card>
            ) : null}
            <Card>
              <CaseCoach solves={solves} />
            </Card>
            <Card>
              <GoalPanel solves={solves} />
            </Card>
          </>
        )}
        {/* Somebody arriving with years of csTimer history should not start
            from zero — it is the single biggest cost of switching. */}
        <Card>
          <CsTimerImport onImported={reload} />
        </Card>
      </div>
    </Shell>
  );
}

function Recommendation({ diagnosis }: { diagnosis: Diagnosis }) {
  if (diagnosis.kind === "insufficient") {
    return (
      <section className="flex flex-col gap-2">
        <h2 className="text-xl">Work on</h2>
        <p className="text-lg text-muted">Not enough solves yet</p>
        <p className="text-sm leading-relaxed text-muted-dim">
          {diagnosis.fact} {diagnosis.interpretation}
        </p>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-xl">Work on</h2>
      <p className="text-3xl font-medium tracking-tight">{diagnosis.phase}</p>

      {/* Arithmetic first, plainly stated. */}
      <p className="text-sm leading-relaxed text-muted">{diagnosis.fact}</p>
      {diagnosis.measured ? (
        <p className="text-sm leading-relaxed text-muted" data-testid="measured">
          {diagnosis.measured}
        </p>
      ) : null}

      {/* Then the judgement, marked as one. */}
      <div className="border-l-2 border-border pl-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-dim">Interpretation</p>
        <p className="mt-1 text-sm leading-relaxed text-muted-dim">{diagnosis.interpretation}</p>
      </div>
    </section>
  );
}

function PhaseTable({ aggregates }: { aggregates: PhaseAggregate[] }) {
  const maxMean = Math.max(...aggregates.map((a) => a.meanMs));

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-xl">By phase</h2>

      <div className="flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-dim">
        <span className="w-12 shrink-0">Phase</span>
        <span className="flex-1" />
        <span className="tnum w-14 shrink-0 text-right">Mean</span>
        <span className="tnum w-14 shrink-0 text-right">Best</span>
        <span className="tnum w-16 shrink-0 text-right">Spread</span>
        <span className="tnum w-10 shrink-0 text-right">n</span>
      </div>

      <div className="flex flex-col gap-1.5">
        {aggregates.map((a) => (
          <div key={a.phase} className="flex items-center gap-3 text-xs">
            <span className="w-12 shrink-0 text-muted">{a.phase}</span>
            <div className="h-2 flex-1 overflow-hidden rounded-sm bg-surface">
              <div
                className="h-full rounded-sm bg-bar"
                style={{ width: `${Math.max((a.meanMs / maxMean) * 100, 1.5)}%` }}
              />
            </div>
            <span className="tnum w-14 shrink-0 text-right text-foreground">
              {formatMs(a.meanMs)}
            </span>
            <span className="tnum w-14 shrink-0 text-right text-muted-dim">
              {formatMs(a.bestMs)}
            </span>
            <span className="tnum w-16 shrink-0 text-right text-muted-dim">
              {a.cv === null ? "—" : `±${Math.round(a.cv * 100)}%`}
            </span>
            <span className="tnum w-10 shrink-0 text-right text-muted-dim">{a.n}</span>
          </div>
        ))}
      </div>

      <p className="text-xs leading-relaxed text-muted-dim">
        Spread is the standard deviation as a share of the mean — how much that phase
        swings from solve to solve, rather than how long it takes.
      </p>
    </section>
  );
}

/**
 * How much of each phase is looking and how much is turning.
 *
 * Turning speed here is turns per second of TURNING — the pauses taken out — so
 * it describes the hands alone. The ordinary TPS figure mixes the two, which is
 * why a cuber with fast hands and slow eyes reads as "slow TPS" and goes off to
 * practise fingertricks they do not need.
 */
function LookTurnTable({ rows }: { rows: LookTurn[] }) {
  if (rows.length === 0) {
    return (
      <section className="flex flex-col gap-2">
        <h2 className="text-xl">Looking and turning</h2>
        <p className="text-xs leading-relaxed text-muted-dim">
          Needs five solves on /play or the daily that recorded their turns. Solves from before
          this was measured, and stopwatch times, can&apos;t tell looking from turning.
        </p>
      </section>
    );
  }

  const maxTotal = Math.max(...rows.map((r) => r.lookMs + r.turnMs));

  return (
    <section className="flex flex-col gap-3" data-testid="look-turn">
      <h2 className="text-xl">Looking and turning</h2>

      <div className="flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-dim">
        <span className="w-12 shrink-0">Phase</span>
        <span className="flex-1" />
        <span className="tnum w-14 shrink-0 text-right">Look</span>
        <span className="tnum w-14 shrink-0 text-right">Turn</span>
        <span className="tnum w-16 shrink-0 text-right">Hands</span>
        <span className="tnum w-10 shrink-0 text-right">n</span>
      </div>

      <div className="flex flex-col gap-1.5">
        {rows.map((r) => {
          const width = ((r.lookMs + r.turnMs) / maxTotal) * 100;
          const lookShare = r.lookMs / (r.lookMs + r.turnMs);
          return (
            <div key={r.phase} className="flex items-center gap-3 text-xs">
              <span className="w-12 shrink-0 text-muted">{r.phase}</span>
              <div className="h-2 flex-1 overflow-hidden rounded-sm bg-surface">
                <div className="flex h-full text-bar" style={{ width: `${Math.max(width, 1.5)}%` }}>
                  <span
                    className="h-full"
                    style={{
                      width: `${lookShare * 100}%`,
                      backgroundImage:
                        "repeating-linear-gradient(135deg, currentColor 0 2px, transparent 2px 5px)",
                    }}
                  />
                  <span className="h-full flex-1 rounded-r-sm bg-current" />
                </div>
              </div>
              <span className="tnum w-14 shrink-0 text-right text-foreground">{formatMs(r.lookMs)}</span>
              <span className="tnum w-14 shrink-0 text-right text-muted">{formatMs(r.turnMs)}</span>
              <span className="tnum w-16 shrink-0 text-right text-muted-dim">
                {r.turningTps.toFixed(1)} tps
              </span>
              <span className="tnum w-10 shrink-0 text-right text-muted-dim">{r.n}</span>
            </div>
          );
        })}
      </div>

      <p className="text-xs leading-relaxed text-muted-dim">
        Look is the time before each step&apos;s first turn — between F2L pairs, and recognising
        the OLL and PLL case. Hands is turning speed with those pauses taken out. The cross is
        left off: its looking happens in inspection, before the clock starts.
      </p>
    </section>
  );
}

function Overview({ solves, trend }: { solves: StoredSolve[]; trend: Trend }) {
  const finished = solves.filter((s) => s.penalty !== "DNF" && s.durationMs > 0);
  const best = finished.length > 0 ? Math.min(...finished.map((s) => s.durationMs)) : null;
  const imported = solves.filter((s) => s.origin === "cstimer").length;

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-xl">Overall</h2>
      <div className="flex flex-wrap gap-x-10 gap-y-4">
        <Stat label="solves" value={String(solves.length)} />
        <Stat label="best" value={best === null ? "—" : formatMs(best)} />
        <Stat label="trend" value={trendLabel(trend)} />
      </div>
      <p className="text-xs leading-relaxed text-muted-dim">{trendExplanation(trend)}</p>
      {imported > 0 ? (
        <p className="text-xs leading-relaxed text-muted-dim" data-testid="imported-count">
          {imported.toLocaleString()} of these came from csTimer: times from a real cube, counted
          here, never rated.
        </p>
      ) : null}
    </section>
  );
}

function trendLabel(trend: Trend): string {
  if (trend.kind === "insufficient") return "—";
  if (trend.kind === "unclear") return "no clear change";
  const seconds = Math.abs(trend.deltaMs) / 1000;
  return `${trend.kind === "improving" ? "−" : "+"}${seconds.toFixed(2)}s`;
}

/**
 * The wording here matters more than the number. A cuber told they improved when
 * the difference is inside normal variation learns the wrong lesson about whatever
 * they changed that week.
 */
function trendExplanation(trend: Trend): string {
  switch (trend.kind) {
    case "insufficient":
      return "A trend needs at least 12 analysed solves before it means anything.";
    case "unclear":
      return `Comparing your last ${trend.recentN} solves against the ${trend.earlierN} before them, the difference is inside normal variation — not yet distinguishable from noise.`;
    case "improving":
      return `Your last ${trend.recentN} solves are faster than the ${trend.earlierN} before them by more than the spread can explain.`;
    case "worsening":
      return `Your last ${trend.recentN} solves are slower than the ${trend.earlierN} before them by more than the spread can explain.`;
  }
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-dim">{label}</span>
      <span className="tnum font-display text-3xl font-bold">{value}</span>
    </div>
  );
}

function Shell({ children, titled = true }: { children: React.ReactNode; titled?: boolean }) {
  return (
    <main className="flex min-h-dvh flex-col">
      <SiteHeader active="progress" />
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-4 pb-24 pt-6 sm:px-8 lg:pt-12">
        {titled ? (
          <PageHero eyebrow="Improve" title="Your progress">
            Where your time goes, what to work on, and whether it is working — from your
            own solves on this device.
          </PageHero>
        ) : (
          <h1 className="sr-only">Your progress</h1>
        )}
        {children}
      </div>
    </main>
  );
}

/** One section of the page, as its own card. */
function Card({ children }: { children: React.ReactNode }) {
  return <div className="rounded-2xl border border-border bg-surface p-5 sm:p-6">{children}</div>;
}

/**
 * The first visit. Not "nothing here" but what will be here, and the one step
 * that starts it — because what fills this page is the reason to come back.
 */
function EmptyProgress() {
  const coming = [
    ["Where the time goes", "Cross, each pair, OLL and PLL — timed on every solve, averaged across them."],
    ["Looking or turning", "Whether a slow phase is slow eyes or slow hands. They need different practice."],
    ["The cases to drill", "The OLL and PLL cases costing you the most, ranked by time you would get back."],
    ["Your habits", "Where you stop, how long your cross runs, which cases take you two looks."],
  ];
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-4">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-sticker-green">Progress</p>
        <p className="font-display text-4xl font-extrabold leading-[1.05] tracking-tight sm:text-5xl">
          Solve once, and this page starts filling in.
        </p>
        <p className="max-w-xl text-base leading-relaxed text-muted">
          Everything here is worked out from your own solves, on this device. No account needed.
        </p>
        <div className="flex flex-wrap gap-3 pt-1">
          <Link href="/play" className="btn-go px-6 py-3 text-[15px]">
            Solve on the keyboard
          </Link>
          <Link href="/timer" className="btn-secondary px-5 py-3 text-[15px]">
            Time a real cube
          </Link>
        </div>
      </div>
      <ul className="grid gap-3 sm:grid-cols-2">
        {coming.map(([title, body]) => (
          <li key={title} className="rounded-2xl border border-border bg-surface p-5">
            <p className="text-[15px] font-semibold">{title}</p>
            <p className="mt-1.5 text-sm leading-relaxed text-muted">{body}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
