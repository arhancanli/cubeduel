import { effectiveMs, trimmedAverage } from "./stats";
import type { Solve } from "./types";

/**
 * The session as a picture: every solve a point, oldest on the left, faster
 * lower down, with the rolling ao5 over it. A column of numbers hides the
 * shape — the warm-up, the slump, the run of good ones — that a glance at this
 * shows at once.
 */

export interface ChartPoint {
  x: number;
  y: number;
  ms: number;
}

export interface SessionChart {
  points: ChartPoint[];
  ao5: { x: number; y: number }[];
  /** x positions of DNFs, drawn as marks on the axis rather than as times. */
  dnfs: number[];
  best: ChartPoint | null;
}

export const CHART_LIMIT = 100;

export function sessionChart(all: readonly Solve[], width: number, height: number): SessionChart | null {
  const solves = all.slice(-CHART_LIMIT);
  if (solves.length < 2) return null;
  const times = solves.map((s) => effectiveMs(s));
  const finite = times.filter((t): t is number => t !== null);
  if (finite.length === 0) return null;

  const lo = Math.min(...finite);
  const hi = Math.max(...finite);
  const span = hi - lo || 1;
  const pad = height * 0.08;
  const xAt = (i: number) => (solves.length === 1 ? 0 : (i / (solves.length - 1)) * width);
  const yAt = (ms: number) => pad + (1 - (ms - lo) / span) * (height - pad * 2);

  const points: ChartPoint[] = [];
  const dnfs: number[] = [];
  times.forEach((ms, i) => {
    if (ms === null) dnfs.push(xAt(i));
    else points.push({ x: xAt(i), y: yAt(ms), ms });
  });

  const ao5: { x: number; y: number }[] = [];
  for (let i = 4; i < solves.length; i++) {
    const avg = trimmedAverage(solves.slice(0, i + 1) as Solve[], 5);
    if (avg.kind === "value") ao5.push({ x: xAt(i), y: yAt(Math.min(hi, Math.max(lo, avg.ms))) });
  }

  const best = points.reduce<ChartPoint | null>((b, p) => (b === null || p.ms < b.ms ? p : b), null);
  return { points, ao5, dnfs, best };
}
