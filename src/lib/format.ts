import type { AvgResult } from "./stats";
import { effectiveMs } from "./stats";
import type { Solve } from "./types";

/**
 * Single times truncate to hundredths — that is what a Stackmat shows, and what
 * every cuber's eye is calibrated to. Averages round instead (see stats.ts),
 * per WCA Regulation 9f2.
 */
export function formatMs(ms: number, { truncate = true }: { truncate?: boolean } = {}): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";

  const centis = truncate ? Math.floor(ms / 10) : Math.round(ms / 10);
  const totalSeconds = Math.floor(centis / 100);
  const hundredths = centis % 100;

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const cc = hundredths.toString().padStart(2, "0");

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds
      .toString()
      .padStart(2, "0")}.${cc}`;
  }
  if (minutes > 0) {
    return `${minutes}:${seconds.toString().padStart(2, "0")}.${cc}`;
  }
  return `${seconds}.${cc}`;
}

/** Live display while the timer is running — hundredths, no trailing precision games. */
export function formatRunning(ms: number): string {
  return formatMs(ms, { truncate: true });
}

export function formatAverage(result: AvgResult): string {
  if (result.kind === "none") return "—";
  if (result.kind === "dnf") return "DNF";
  return formatMs(result.ms, { truncate: false });
}

/**
 * A solve as it appears in the list: DNF wins over everything, +2 shows the
 * penalised time with a trailing marker so it is never mistaken for a clean one.
 */
export function formatSolve(solve: Solve): string {
  if (solve.penalty === "DNF") return "DNF";
  const eff = effectiveMs(solve);
  if (eff === null) return "DNF";
  return solve.penalty === "PLUS2" ? `${formatMs(eff)}+` : formatMs(eff);
}
