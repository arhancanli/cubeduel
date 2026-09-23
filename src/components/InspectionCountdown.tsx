"use client";

import { useEffect, useState } from "react";

import { inspectionStateAt } from "@/lib/inspection";

/**
 * The WCA inspection clock, on screen.
 *
 * Every mode that issues a server-timed scramble shows this, so it lives in one
 * place. Two copies would eventually disagree, and the failure mode is nasty in
 * a specific way: the number on screen would stop matching the penalty the
 * server applies, and a countdown that says "+2" while the server charges a DNF
 * is worse than showing no countdown at all.
 *
 * Driven from `performance.now()` rather than a decrementing counter. A counter
 * that ticks once per frame quietly runs slow whenever the tab is busy, which
 * would show the player more time than they actually have — and they would find
 * out from the penalty.
 */
export function InspectionCountdown({ active }: { active: boolean }) {
  const [elapsed, setElapsed] = useState<number | null>(null);

  useEffect(() => {
    if (!active) return;

    const startedAt = performance.now();
    let frame = 0;
    const tick = () => {
      setElapsed(performance.now() - startedAt);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);

    // Cleared on the way out rather than on the way in. Resetting when inactive
    // would be a synchronous setState inside an effect, and leaving it set would
    // show the previous attempt's reading for one frame the next time inspection
    // opens — a countdown that flashes "0.4" before jumping to 15 is worse than
    // one that appears a frame late.
    return () => {
      cancelAnimationFrame(frame);
      setElapsed(null);
    };
  }, [active]);

  if (!active || elapsed === null) return null;

  const state = inspectionStateAt(elapsed);
  const tone =
    state.pendingPenalty === "DNF"
      ? "text-danger"
      : state.pendingPenalty === "PLUS2"
        ? "text-holding"
        : "text-muted";

  // The 8 and 12 second calls are not decoration: a cuber who has competed is
  // used to hearing a judge say them and paces the last third of inspection
  // around them.
  const label =
    state.pendingPenalty === "DNF"
      ? "inspection — DNF"
      : state.pendingPenalty === "PLUS2"
        ? "inspection — +2"
        : state.warningsPassed === 2
          ? "12 seconds"
          : state.warningsPassed === 1
            ? "8 seconds"
            : "inspection";

  return (
    <div className="flex flex-col items-center gap-1">
      <span
        data-testid="inspection-countdown"
        className={`tnum text-3xl font-medium ${tone}`}
      >
        {(state.remainingMs / 1000).toFixed(1)}
      </span>
      <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-dim">{label}</span>
    </div>
  );
}
