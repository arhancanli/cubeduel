"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { AlgDemo } from "@/components/AlgDemo";
import { formatMs } from "@/lib/format";
import type { StoredSolve } from "@/lib/solveHistory";
import { crossOptions, MIN_OTHERS, reviewSplits, turnOver, type CrossOption, type PhaseReview } from "@/lib/timerReview";

const DOT: Record<string, string> = {
  white: "bg-sticker-white",
  yellow: "bg-sticker-yellow",
  green: "bg-sticker-green",
  blue: "bg-sticker-blue",
  red: "bg-sticker-red",
  orange: "bg-sticker-orange",
};

const VERDICT: Record<PhaseReview["verdict"], { label: string; className: string } | null> = {
  slower: { label: "Slower than usual", className: "text-danger" },
  faster: { label: "Faster than usual", className: "text-ready" },
  usual: null,
  unknown: null,
};

/**
 * The review for a solve timed on a real cube: its phases against your own,
 * when they were split, and the best cross the scramble offered.
 */
export function TimerSolveReview({ solve, history }: { solve: StoredSolve; history: StoredSolve[] }) {
  const splits = reviewSplits(solve, history);
  const [crosses, setCrosses] = useState<CrossOption[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    crossOptions(solve.scramble).then(
      (options) => !cancelled && setCrosses(options),
      () => !cancelled && setCrosses([]),
    );
    return () => {
      cancelled = true;
    };
  }, [solve.scramble]);

  return (
    <div className="flex flex-col gap-10">
      {splits ? <Phases review={splits} /> : <NoSplits />}
      <BestCross options={crosses} scramble={solve.scramble} />
    </div>
  );
}

function Phases({ review }: { review: NonNullable<ReturnType<typeof reviewSplits>> }) {
  const total = review.phases.reduce((a, p) => a + p.ms, 0);
  const costliest = review.phases.find((p) => p.phase === review.costliest);
  const judged = review.phases.some((p) => p.verdict !== "unknown");

  return (
    <section className="flex flex-col gap-4" data-testid="timer-phases">
      <h2 className="text-xl">Your phases</h2>
      <p className="max-w-2xl text-sm leading-relaxed text-muted" data-testid="timer-phases-summary">
        {!judged
          ? `Split ${MIN_OTHERS - review.sample} more solve${MIN_OTHERS - review.sample === 1 ? "" : "s"} and each phase will be set against your usual.`
          : costliest && costliest.usualMs !== null
            ? `${costliest.phase} cost you this solve: ${formatMs(costliest.ms, { truncate: false })} against your usual ${formatMs(costliest.usualMs, { truncate: false })}.`
            : "Every phase was within your usual range."}
      </p>
      <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
        {review.phases.map((p) => {
          const verdict = VERDICT[p.verdict];
          return (
            <li key={p.phase} className="grid grid-cols-[4.5rem_minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-5 py-3.5">
              <span className="text-sm font-semibold">{p.phase}</span>
              <span className="h-2 overflow-hidden rounded-full bg-surface-hi" aria-hidden="true">
                <span
                  className={`block h-full rounded-full ${p.verdict === "slower" ? "bg-danger" : p.verdict === "faster" ? "bg-ready" : "bg-muted-dim"}`}
                  style={{ width: `${total > 0 ? (p.ms / total) * 100 : 0}%` }}
                />
              </span>
              <span className="tnum text-right font-display text-lg font-bold">
                {formatMs(p.ms, { truncate: false })}
              </span>
              {p.usualMs !== null ? (
                <span className="col-span-3 text-xs text-muted-dim sm:col-start-2">
                  {verdict ? (
                    <>
                      <span className={verdict.className}>{verdict.label}</span>
                      {" · "}
                    </>
                  ) : null}
                  usual {formatMs(p.usualMs, { truncate: false })}
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
      {judged ? (
        <p className="text-xs text-muted-dim">
          Your usual is the average of your last {review.sample} split solves. A phase is only called
          slower or faster when it is outside the ordinary spread between them, and by at least a
          tenth.
        </p>
      ) : null}
    </section>
  );
}

function NoSplits() {
  return (
    <section className="flex flex-col items-start gap-3 rounded-2xl border border-dashed border-border px-5 py-5">
      <h2 className="text-lg">Which phase cost you?</h2>
      <p className="max-w-xl text-sm leading-relaxed text-muted">
        This solve was timed without phase splits. Turn them on under the timer and press space as
        each phase ends — cross, F2L, OLL, PLL — and every solve will show where its time went,
        against your own usual.
      </p>
      <Link href="/timer" className="text-sm font-semibold underline decoration-border underline-offset-4 hover:decoration-current">
        Open the timer
      </Link>
    </section>
  );
}

function BestCross({ options, scramble }: { options: CrossOption[] | null; scramble: string }) {
  if (options === null) {
    return (
      <section className="flex flex-col gap-3" aria-busy="true">
        <h2 className="text-xl">The best cross in this scramble</h2>
        <p className="text-sm text-muted-dim">Working out the shortest cross on every face…</p>
      </section>
    );
  }
  const white = options.find((o) => o.face === "U");
  if (!white) return null;
  const best = options[0];
  const saving = white.moves - best.moves;

  return (
    <section className="flex flex-col gap-4" data-testid="timer-cross">
      <h2 className="text-xl">The best cross in this scramble</h2>
      <p className="max-w-2xl text-sm leading-relaxed text-muted" data-testid="timer-cross-summary">
        The shortest white cross was {white.moves} turn{white.moves === 1 ? "" : "s"}.{" "}
        {saving > 0
          ? `A ${best.colour} cross was ${best.moves} — ${saving} fewer. That is what solving on any colour buys.`
          : "No other colour was shorter: white was the right cross to build."}
      </p>
      <div className="grid gap-6 md:grid-cols-[minmax(0,17rem)_minmax(0,1fr)]">
        <div className="panel flex flex-col gap-3 rounded-xl p-4">
          <h3 className="text-sm">White cross, from the scramble</h3>
          {/* Scrambled white-up, then turned over to build the cross underneath,
              as most people do; the route is rewritten for that hold. */}
          {/* Seen from below: the cross is built on the bottom, and from the
              usual angle above it the finished cross could not be seen at all. */}
          <AlgDemo
            alg={turnOver(white.solution)}
            label="Shortest white cross"
            from={`${scramble} z2`}
            cameraLatitude={-40}
          />
          <p className="text-xs leading-relaxed text-muted-dim">
            Scramble with white on top and green in front, then turn the cube over — green still
            facing you — and build the cross on the bottom.
          </p>
        </div>
        <ul className="flex flex-col divide-y divide-border self-start overflow-hidden rounded-2xl border border-border bg-surface">
          {options.map((o) => (
            <li key={o.face} className="flex items-center gap-3 px-4 py-3" data-testid="timer-cross-option">
              <span className={`size-3 shrink-0 rounded-sm ${DOT[o.colour]}`} aria-hidden="true" />
              <span className="flex-1 text-sm">
                {o.colour[0].toUpperCase() + o.colour.slice(1)} cross
              </span>
              <span className="tnum text-sm font-semibold">
                {o.moves} turn{o.moves === 1 ? "" : "s"}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
