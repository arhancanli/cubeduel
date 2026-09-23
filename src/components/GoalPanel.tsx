"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { buildPlan, currentAverage, evaluateGoal, type Goal, type Plan } from "@/lib/coach";
import { buildNameTable } from "@/lib/caseStats";
import { formatMs } from "@/lib/format";
import { clearGoal, loadGoal, saveGoal } from "@/lib/goalStorage";
import type { StoredSolve } from "@/lib/solveHistory";

/**
 * A goal, and whether the evidence supports saying anything about it.
 *
 * The design constraint is the interesting part. Every timer app offers a
 * projection — "on track for sub-15 by March" — and almost none can justify it;
 * they fit a line through noise and read a date off it. This one refuses unless
 * the improvement clears twice the standard error of the difference between
 * halves of the sample, which means the honest answer most of the time is "your
 * times are not changing in a way that stands out yet".
 *
 * That is a worse-looking screen and a better product. Someone congratulated for
 * random drift learns the wrong lesson about whatever they changed that week.
 */

/** Goals cubers actually set, in the language they use. */
const PRESETS = [
  { label: "sub-60", ms: 60_000 },
  { label: "sub-30", ms: 30_000 },
  { label: "sub-20", ms: 20_000 },
  { label: "sub-15", ms: 15_000 },
  { label: "sub-10", ms: 10_000 },
];

/**
 * Built outside the component so the clock is read where it plainly belongs.
 *
 * `Date.now()` inside the body — even inside a click handler defined there — is
 * flagged as an impure call during render, and the rule is right to be strict:
 * a component that reads the clock while rendering produces results that change
 * on a re-render nobody asked for. The baseline is where the player stands the
 * day they commit, so progress has something to be measured from; without it
 * "40% of the way there" means nothing.
 */
function makeGoal(targetMs: number, baselineMs: number): Goal {
  return { targetMs, baselineMs, setAt: Date.now() };
}

export function GoalPanel({ solves }: { solves: StoredSolve[] }) {
  const [goal, setGoal] = useState<Goal | null>(null);
  const [names, setNames] = useState<ReadonlyMap<string, string>>(new Map());

  useEffect(() => {
    setGoal(loadGoal());
  }, []);

  useEffect(() => {
    let cancelled = false;
    void buildNameTable()
      .then((table) => {
        if (!cancelled) setNames(table);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const progress = evaluateGoal(goal, solves);
  const plan = buildPlan(solves, goal, names);
  const current = currentAverage(solves);

  const set = (targetMs: number) => {
    const next = makeGoal(targetMs, current ?? targetMs * 1.5);
    saveGoal(next);
    setGoal(next);
  };

  if (!goal) {
    return (
      <section className="flex flex-col gap-3">
        <h2 className="text-xl">Goal</h2>
        <p className="text-sm text-muted">
          Pick a target and this page will track it — honestly, which mostly
          means telling you when the evidence cannot yet say anything.
        </p>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              onClick={() => set(preset.ms)}
              className="rounded-lg border border-border px-4 py-2 text-sm text-muted transition-colors hover:border-muted-dim hover:text-foreground"
            >
              {preset.label}
            </button>
          ))}
        </div>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-xl">Goal</h2>
        <button
          type="button"
          onClick={() => {
            clearGoal();
            setGoal(null);
          }}
          className="text-[11px] text-muted-dim transition-colors hover:text-foreground"
        >
          Change goal
        </button>
      </div>

      <div className="flex flex-wrap items-end gap-x-10 gap-y-4">
        <Figure
          label="target"
          value={formatMs(progress.targetMs, { truncate: false })}
        />
        <Figure
          label="now"
          value={progress.currentMs === null ? "—" : formatMs(progress.currentMs, { truncate: false })}
          note="mean of your last 12"
        />
        <Figure
          label="started at"
          value={formatMs(progress.baselineMs, { truncate: false })}
        />
      </div>

      {progress.closed !== null ? (
        <div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-hi">
            <div
              className="h-full rounded-full bg-bar"
              style={{ width: `${Math.round(progress.closed * 100)}%` }}
            />
          </div>
          <p className="mt-1.5 text-[11px] text-muted-dim">
            {Math.round(progress.closed * 100)}% of the way from where you started
          </p>
        </div>
      ) : null}

      <p
        className={`max-w-prose text-sm leading-relaxed ${
          progress.status === "reached"
            ? "text-ready"
            : progress.status === "worsening"
              ? "text-danger"
              : "text-muted"
        }`}
      >
        {progress.explanation}
      </p>

      <PlanView plan={plan} />
    </section>
  );
}

/**
 * Whether the plan can actually get there — and nothing else.
 *
 * Deliberately NOT a list of cases. `CaseCoach` renders those below with their
 * diagrams, which is how cubers recognise a case, and two competing lists of the
 * same three algorithms is clutter rather than emphasis. The question this
 * section answers is the one that list cannot: is fixing them enough?
 */
function PlanView({ plan }: { plan: Plan }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="max-w-prose text-xs leading-relaxed text-muted-dim">
        {plan.verdict}
      </p>
      {plan.items.length > 0 ? (
        <Link
          href="/train"
          className="self-start rounded-lg border border-border px-4 py-2 text-xs text-muted transition-colors hover:border-muted-dim hover:text-foreground"
        >
          Drill them →
        </Link>
      ) : null}
    </div>
  );
}

function Figure({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-dim">{label}</span>
      <span className="tnum text-2xl font-medium">{value}</span>
      {note ? <span className="text-[11px] text-muted-dim">{note}</span> : null}
    </div>
  );
}
