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
 *
 * Each bar is split in two where the move stream allows: the striped part is the
 * time before the phase's first turn — looking — and the solid part is turning.
 * Striped rather than a second colour, so the difference survives colour
 * blindness, greyscale and a dim screen alike.
 */

/** A phase's looking, when it was measured and means something. */
function lookOf(split: PhaseSplit): number | null {
  // The cross's first turn is the clock's zero: its looking was inspection, and
  // a 0.00s "looking" segment would be true and misleading at once.
  if (split.phase === "Cross" || split.recognitionMs === undefined) return null;
  return Math.min(split.recognitionMs, split.durationMs);
}

const STRIPES = {
  backgroundImage:
    "repeating-linear-gradient(135deg, currentColor 0 2px, transparent 2px 5px)",
} as const;

export function SolveBreakdown({ splits }: { splits: PhaseSplit[] }) {
  if (splits.length === 0) return null;

  const total = splits.reduce((sum, s) => sum + s.durationMs, 0);
  const slowest = splits.reduce((a, b) => (b.durationMs > a.durationMs ? b : a));
  // Hand-recorded splits have times but no turns. Printing "0 mv · 0.0 tps" would
  // put a fabricated measurement beside a real one.
  const hasMoveData = splits.some((s) => s.moveCount > 0);
  const looks = splits.map(lookOf);
  const measured = looks.some((l) => l !== null);
  const totalLook = looks.reduce<number>((a, l) => a + (l ?? 0), 0);
  const slowestLook = lookOf(slowest);

  return (
    <div className="flex w-full max-w-xl flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        {splits.map((split, i) => {
          const share = total > 0 ? split.durationMs / total : 0;
          const isSlowest = split.phase === slowest.phase;
          const look = looks[i];
          const lookShare = look !== null && split.durationMs > 0 ? look / split.durationMs : 0;
          const tone = isSlowest ? "text-holding" : "text-bar";
          return (
            <div key={split.phase} className="flex items-center gap-3 text-xs">
              <span
                className={`w-14 shrink-0 ${isSlowest ? "text-foreground" : "text-muted-dim"}`}
              >
                {split.phase}
              </span>

              <div className="h-2 flex-1 overflow-hidden rounded-sm bg-surface">
                <div
                  className={`flex h-full ${tone}`}
                  style={{ width: `${Math.max(share * 100, 1.5)}%` }}
                  role={look !== null ? "img" : undefined}
                  aria-label={
                    look !== null
                      ? `${split.phase}: ${formatMs(look)} looking, ${formatMs(split.durationMs - look)} turning`
                      : undefined
                  }
                  data-look-ms={look !== null ? Math.round(look) : undefined}
                >
                  {lookShare > 0 ? (
                    <span className="h-full" style={{ width: `${lookShare * 100}%`, ...STRIPES }} />
                  ) : null}
                  <span className="h-full flex-1 rounded-r-sm bg-current" />
                </div>
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

      {measured ? (
        <div className="flex items-center gap-4 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-dim">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-4 rounded-sm text-bar" style={STRIPES} />
            looking
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-4 rounded-sm bg-bar" />
            turning
          </span>
          <span className="tnum normal-case tracking-normal" data-testid="total-looking">
            {formatMs(totalLook)} of {formatMs(total)} spent looking
          </span>
        </div>
      ) : null}

      <p className="text-xs leading-relaxed text-muted-dim">
        <span className="text-muted">{slowest.phase}</span> took the longest at{" "}
        {formatMs(slowest.durationMs)} —{" "}
        {Math.round((slowest.durationMs / total) * 100)}% of the solve
        {slowestLook !== null ? (
          <>
            : {formatMs(slowestLook)} before its first turn, and{" "}
            {formatMs(slowest.durationMs - slowestLook)} turning.
          </>
        ) : slowest.tps < 3 && slowest.moveCount > 0 ? (
          ". The turn rate there is low, so the time is going into recognition rather than execution."
        ) : (
          "."
        )}
        {hasMoveData
          ? ""
          : " Times only — a hand-timed solve can't show turns, so move count and turn rate aren't known."}
      </p>
    </div>
  );
}
