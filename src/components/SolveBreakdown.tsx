"use client";

import { formatMs } from "@/lib/format";
import type { PhaseSplit } from "@/lib/cfop";

/**
 * Where the solve actually went.
 *
 * A total time is not actionable — every cuber already knows they were slow. The
 * breakdown names the one phase costing the most, because improvement in this sport
 * is almost entirely a matter of finding which specific step you are worst at and
 * drilling that, rather than "getting faster" in general.
 *
 * Bars are proportional to time rather than a fixed scale, so the eye lands on the
 * expensive phase before reading a single number.
 */
export function SolveBreakdown({ splits }: { splits: PhaseSplit[] }) {
  if (splits.length === 0) return null;

  const total = splits.reduce((sum, s) => sum + s.durationMs, 0);
  const slowest = splits.reduce((a, b) => (b.durationMs > a.durationMs ? b : a));
  // Hand-recorded splits have times but no turns. Printing "0 mv · 0.0 tps" would
  // put a fabricated measurement beside a real one.
  const hasMoveData = splits.some((s) => s.moveCount > 0);

  return (
    <div className="flex w-full max-w-xl flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        {splits.map((split) => {
          const share = total > 0 ? split.durationMs / total : 0;
          const isSlowest = split.phase === slowest.phase;
          return (
            <div key={split.phase} className="flex items-center gap-3 text-xs">
              <span
                className={`w-14 shrink-0 ${isSlowest ? "text-foreground" : "text-muted-dim"}`}
              >
                {split.phase}
              </span>

              <div className="h-2 flex-1 overflow-hidden rounded-sm bg-surface">
                <div
                  className={`h-full rounded-sm ${isSlowest ? "bg-holding" : "bg-bar"}`}
                  style={{ width: `${Math.max(share * 100, 1.5)}%` }}
                />
              </div>

              <span
                className={`tnum w-12 shrink-0 text-right ${
                  isSlowest ? "text-foreground" : "text-muted"
                }`}
              >
                {formatMs(split.durationMs)}
              </span>
              {hasMoveData ? (
                <>
                  <span className="tnum w-14 shrink-0 text-right text-muted-dim">
                    {split.moveCount} mv
                  </span>
                  <span className="tnum w-16 shrink-0 text-right text-muted-dim">
                    {split.tps.toFixed(1)} tps
                  </span>
                </>
              ) : null}
            </div>
          );
        })}
      </div>

      <p className="text-xs leading-relaxed text-muted-dim">
        <span className="text-muted">{slowest.phase}</span> took the longest at{" "}
        {formatMs(slowest.durationMs)} —{" "}
        {Math.round((slowest.durationMs / total) * 100)}% of the solve
        {slowest.tps < 3 && slowest.moveCount > 0
          ? ". The turn rate there is low, so the time is going into recognition rather than execution."
          : "."}
        {hasMoveData
          ? ""
          : " Times only — a hand-timed solve can't show turns, so move count and turn rate aren't known."}
      </p>
    </div>
  );
}
