"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { CaseCoach } from "@/components/CaseCoach";
import { CsTimerImport } from "@/components/CsTimerImport";
import { GoalPanel } from "@/components/GoalPanel";
import { SiteHeader } from "@/components/SiteHeader";
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
    setSolves(loadHistory());
  }, []);

  if (solves === null) {
    return <Shell>{null}</Shell>;
  }

  const aggregates = aggregatePhases(solves);
  const diagnosis = diagnose(solves);
  const looking = lookAndTurn(solves);
  const trend = totalTimeTrend(solves);

  const reload = () => setSolves(loadHistory());

  // One layout for both states, with the importer in the same place in each.
  // Importing into an empty history turns this page from the empty state into
  // the full one; if the importer lived in two different trees it would be
  // unmounted at exactly that moment, taking its "Added 2,000 solves" with it.
  return (
    <Shell>
      <div className="flex w-full max-w-2xl flex-col gap-10">
        {solves.length === 0 ? (
          <div className="flex flex-col items-center gap-4 text-center">
            <p className="text-sm text-muted">No solves recorded yet.</p>
            <Link
              href="/play"
              className="rounded-lg bg-foreground px-5 py-2.5 text-sm font-medium text-background transition-opacity hover:opacity-90"
            >
              Start solving
            </Link>
          </div>
        ) : (
          <>
            <GoalPanel solves={solves} />
            <Recommendation diagnosis={diagnosis} />
            {aggregates.length > 0 ? <PhaseTable aggregates={aggregates} /> : null}
            {aggregates.length > 0 ? <LookTurnTable rows={looking} /> : null}
            <CaseCoach solves={solves} />
            <Overview solves={solves} trend={trend} />
          </>
        )}
        {/* Somebody arriving with years of csTimer history should not start
            from zero — it is the single biggest cost of switching. */}
        <CsTimerImport onImported={reload} />
      </div>
    </Shell>
  );
}

function Recommendation({ diagnosis }: { diagnosis: Diagnosis }) {
  if (diagnosis.kind === "insufficient") {
    return (
      <section className="flex flex-col gap-2">
        <h2 className="text-[10px] uppercase tracking-widest text-muted-dim">Work on</h2>
        <p className="text-lg text-muted">Not enough solves yet</p>
        <p className="text-sm leading-relaxed text-muted-dim">
          {diagnosis.fact} {diagnosis.interpretation}
        </p>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-[10px] uppercase tracking-widest text-muted-dim">Work on</h2>
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
        <p className="text-[10px] uppercase tracking-widest text-muted-dim">Interpretation</p>
        <p className="mt-1 text-sm leading-relaxed text-muted-dim">{diagnosis.interpretation}</p>
      </div>
    </section>
  );
}

function PhaseTable({ aggregates }: { aggregates: PhaseAggregate[] }) {
  const maxMean = Math.max(...aggregates.map((a) => a.meanMs));

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-[10px] uppercase tracking-widest text-muted-dim">By phase</h2>

      <div className="flex items-center gap-3 text-[10px] uppercase tracking-widest text-muted-dim">
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
        <h2 className="text-[10px] uppercase tracking-widest text-muted-dim">Looking and turning</h2>
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
      <h2 className="text-[10px] uppercase tracking-widest text-muted-dim">Looking and turning</h2>

      <div className="flex items-center gap-3 text-[10px] uppercase tracking-widest text-muted-dim">
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
      <h2 className="text-[10px] uppercase tracking-widest text-muted-dim">Overall</h2>
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
      <span className="text-[10px] uppercase tracking-widest text-muted-dim">{label}</span>
      <span className="tnum text-lg font-medium text-muted">{value}</span>
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col">
      <SiteHeader active="progress" />
      {/* The page title, for assistive tech. This screen is deliberately
          chrome-free — a visible heading beside the clock would be noise. */}
      <h1 className="sr-only">Your progress</h1>
      <div className="flex flex-1 justify-center px-6 py-8">{children}</div>
    </main>
  );
}
