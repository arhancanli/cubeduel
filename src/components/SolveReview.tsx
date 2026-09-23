"use client";

import Link from "next/link";

import { formatMs } from "@/lib/format";
import type { SolveReview as Review } from "@/lib/solveReview";

/**
 * The terminal state of a solve.
 *
 * Not "next scramble" — the review. It has to fight for the same click as another
 * attempt, at the moment of highest emotion, or it never gets read. Chess.com's own
 * diagnosis-to-practice handoff failed exactly here: they removed suggested lessons
 * from Game Review because a recommendation that requires leaving the screen gets
 * ignored. So the drill is the primary button and "Again" is demoted.
 *
 * Everything stated is measured against the solver's own history. There is no model
 * of a better cuber in here, and nothing is claimed before there is enough history
 * to claim it.
 */
export function SolveReviewPanel({
  review,
  drillHref,
  onAgain,
}: {
  review: Review;
  /** Where the culprit is practised. Null when there is nothing specific to drill. */
  drillHref: string | null;
  onAgain: () => void;
}) {
  if (review.kind === "no-splits") {
    return (
      <Shell>
        <p className="max-w-sm text-sm leading-relaxed text-muted-dim">
          Times only. Turn on phase splits and tap through the stages as you solve, and
          this becomes a breakdown of where the time actually went.
        </p>
        <Again onAgain={onAgain} />
      </Shell>
    );
  }

  if (review.kind === "no-par") {
    const needed = 5 - review.sampleSize;
    return (
      <Shell>
        <p className="max-w-sm text-sm leading-relaxed text-muted-dim">
          {review.sampleSize === 0
            ? "One solve can't tell us anything."
            : `${review.sampleSize} solves so far.`}{" "}
          {needed} more with splits and we can name the phase costing you the most.
        </p>
        <Again onAgain={onAgain} />
      </Shell>
    );
  }

  const { culprit, gapMs, parMs } = review;
  const slower = (gapMs ?? 0) > 0;

  return (
    <Shell>
      <p className="max-w-md text-sm leading-relaxed">
        <span className="tnum text-foreground">{formatMs(review.durationMs)}</span>
        <span className="text-muted-dim">
          {" "}
          against your usual <span className="tnum">{formatMs(parMs ?? 0)}</span> —{" "}
        </span>
        <span className={slower ? "text-holding" : "text-ready"}>
          {slower ? "+" : "−"}
          <span className="tnum">{formatMs(Math.abs(gapMs ?? 0))}</span>
        </span>
      </p>

      <div className="flex w-full max-w-md flex-col gap-1.5">
        {review.gaps.map((gap) => {
          const isCulprit = culprit?.phase === gap.phase;
          const lost = gap.gapMs > 0;
          return (
            <div key={gap.phase} className="flex items-center gap-3 text-xs">
              <span className={`w-12 shrink-0 ${isCulprit ? "text-foreground" : "text-muted-dim"}`}>
                {gap.phase}
              </span>
              <span className="tnum w-14 shrink-0 text-right text-muted">
                {formatMs(gap.actualMs)}
              </span>
              <span className="w-16 shrink-0 text-right text-muted-dim">
                par {formatMs(gap.parMs)}
              </span>
              <span
                className={`tnum flex-1 text-right ${
                  !lost ? "text-ready" : isCulprit ? "text-holding" : "text-muted-dim"
                }`}
              >
                {lost ? "+" : "−"}
                {formatMs(Math.abs(gap.gapMs))}
              </span>
            </div>
          );
        })}
      </div>

      {culprit ? (
        <p className="max-w-md text-sm leading-relaxed text-muted">
          Most of the gap was <span className="text-foreground">{culprit.phase}</span> —{" "}
          {formatMs(culprit.gapMs)} slower than you usually are
          {review.culpritShare > 0.5
            ? `, ${Math.round(review.culpritShare * 100)}% of everything you lost.`
            : "."}
        </p>
      ) : (
        <p className="max-w-md text-sm leading-relaxed text-ready">
          Nothing was slower than usual. That was a clean one.
        </p>
      )}

      <div className="flex flex-wrap items-center justify-center gap-3">
        {culprit && drillHref ? (
          <Link
            href={drillHref}
            className="btn-go px-5 py-2.5 text-sm"
          >
            Drill {culprit.phase}
          </Link>
        ) : null}
        <Again onAgain={onAgain} secondary={Boolean(culprit && drillHref)} />
      </div>
    </Shell>
  );
}

function Again({ onAgain, secondary = false }: { onAgain: () => void; secondary?: boolean }) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.currentTarget.blur();
        onAgain();
      }}
      className={
        secondary
          ? "rounded-lg border border-border px-5 py-2.5 text-sm text-muted transition-colors hover:border-muted-dim hover:text-foreground"
          : "btn-go px-5 py-2.5 text-sm"
      }
    >
      Again
    </button>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col items-center gap-5 text-center">{children}</div>;
}
