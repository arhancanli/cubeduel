import type { EventId } from "./events";
import { effectiveMs, trimmedAverage } from "./stats";
import type { Penalty } from "./types";

/**
 * The barriers cubers actually talk about: sub-1 minute, sub-30, sub-20, sub-10.
 *
 * Each rung is earned three ways — a single, an ao5 and an ao12 — because a
 * single under 20 is a good day and an ao12 under 20 is a new level, and the
 * community says "sub-20" meaning the second. Nothing here is stored: every
 * milestone is derived from the solves themselves, so a penalty added later, a
 * deleted solve or an import moves it, and every one points at the solve that
 * earned it.
 *
 * A keyboard solve and a solve on a real cube are different skills with
 * different times, so the 3x3 has a ladder for each. The bigger puzzles are
 * only timed on a real cube.
 */

export type Hand = "cube" | "keyboard";
export type Kind = "single" | "ao5" | "ao12";
export const KINDS: readonly Kind[] = ["single", "ao5", "ao12"];

export interface MilestoneSolve {
  id: string;
  at: number;
  /** Raw stopped time, before the penalty. */
  ms: number;
  penalty: Penalty;
  event: EventId;
  hand: Hand;
}

export interface Track {
  key: string;
  event: EventId;
  hand: Hand;
  label: string;
  /** How a sentence says where it was done: "on a 3×3", "on the keyboard". */
  where: string;
  /** Barriers in ms, slowest first. A rung is earned by a result strictly under it. */
  rungs: readonly number[];
}

const s = (seconds: number) => seconds * 1000;

const LADDER_333 = [120, 60, 45, 30, 25, 20, 17, 15, 12, 10].map(s);

export const TRACKS: readonly Track[] = [
  { key: "333-cube", event: "333", hand: "cube", label: "3×3", where: "on a 3×3", rungs: LADDER_333 },
  { key: "333-keyboard", event: "333", hand: "keyboard", label: "3×3 keyboard", where: "on the keyboard", rungs: LADDER_333 },
  { key: "222-cube", event: "222", hand: "cube", label: "2×2", where: "on a 2×2", rungs: [30, 20, 15, 10, 7, 5, 3].map(s) },
  { key: "444-cube", event: "444", hand: "cube", label: "4×4", where: "on a 4×4", rungs: [240, 180, 120, 90, 75, 60, 50, 40].map(s) },
  { key: "555-cube", event: "555", hand: "cube", label: "5×5", where: "on a 5×5", rungs: [360, 240, 180, 150, 120, 100, 80, 60].map(s) },
];

/** How cubers say it: "sub-20", "sub-1:30", "sub-2 minutes". */
export function rungName(underMs: number): string {
  const total = Math.round(underMs / 1000);
  if (total < 60) return `Sub-${total}`;
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (seconds === 0) return `Sub-${minutes} minute${minutes === 1 ? "" : "s"}`;
  return `Sub-${minutes}:${String(seconds).padStart(2, "0")}`;
}

/** The barrier in words: "20 seconds", "1 minute", "1:30". */
export function barrierPhrase(underMs: number): string {
  const total = Math.round(underMs / 1000);
  if (total < 60) return `${total} seconds`;
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (seconds === 0) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export interface Earned {
  kind: Kind;
  underMs: number;
  /** When the solve that completed it was done. */
  at: number;
  /** The solve that completed it — for an average, the last of its window. */
  solveId: string;
  /** The single or the average that got under the barrier. */
  resultMs: number;
}

export interface Rung {
  underMs: number;
  single: Earned | null;
  ao5: Earned | null;
  ao12: Earned | null;
}

export interface NextTarget {
  underMs: number;
  /** How far your best is from it. Null when there is no result of that kind yet. */
  gapMs: number | null;
}

export interface TrackProgress {
  track: Track;
  solveCount: number;
  best: Record<Kind, number | null>;
  rungs: Rung[];
  /** The fastest barrier not yet broken, per kind. Null once the ladder is finished. */
  next: Record<Kind, NextTarget | null>;
}

/** Results are compared as the WCA records them: truncated to centiseconds. */
function singleResult(solve: MilestoneSolve): number | null {
  const effective = effectiveMs({ ms: solve.ms, penalty: solve.penalty });
  return effective === null ? null : Math.floor(effective / 10) * 10;
}

export function trackProgress(track: Track, all: readonly MilestoneSolve[]): TrackProgress {
  const solves = all
    .filter((solve) => solve.event === track.event && solve.hand === track.hand)
    .sort((a, b) => a.at - b.at);

  const best: Record<Kind, number | null> = { single: null, ao5: null, ao12: null };
  const earned: Record<Kind, Map<number, Earned>> = { single: new Map(), ao5: new Map(), ao12: new Map() };
  const timed = solves.map((solve) => ({ ms: solve.ms, penalty: solve.penalty }));

  const consider = (kind: Kind, result: number | null, solve: MilestoneSolve) => {
    if (result === null) return;
    const previous = best[kind];
    if (previous !== null && result >= previous) return;
    best[kind] = result;
    for (const underMs of track.rungs) {
      if (result < underMs && !earned[kind].has(underMs)) {
        earned[kind].set(underMs, { kind, underMs, at: solve.at, solveId: solve.id, resultMs: result });
      }
    }
  };

  solves.forEach((solve, i) => {
    consider("single", singleResult(solve), solve);
    for (const [kind, size] of [["ao5", 5], ["ao12", 12]] as const) {
      if (i + 1 < size) continue;
      const average = trimmedAverage(timed.slice(i + 1 - size, i + 1), size);
      consider(kind, average.kind === "value" ? average.ms : null, solve);
    }
  });

  const rungs = track.rungs.map((underMs) => ({
    underMs,
    single: earned.single.get(underMs) ?? null,
    ao5: earned.ao5.get(underMs) ?? null,
    ao12: earned.ao12.get(underMs) ?? null,
  }));

  const next = {} as Record<Kind, NextTarget | null>;
  for (const kind of KINDS) {
    const underMs = track.rungs.find((rung) => !earned[kind].has(rung));
    const current = best[kind];
    next[kind] = underMs === undefined ? null : { underMs, gapMs: current === null ? null : current - underMs };
  }

  return { track, solveCount: solves.length, best, rungs, next };
}

/** Every ladder somebody has at least one solve on, in the order of `TRACKS`. */
export function milestones(solves: readonly MilestoneSolve[]): TrackProgress[] {
  return TRACKS.map((track) => trackProgress(track, solves)).filter((progress) => progress.solveCount > 0);
}

/**
 * What one solve earned — the moment worth celebrating. Only the fastest
 * barrier of each kind: a first-ever solve of 25 seconds breaks sub-2 minutes,
 * sub-1, sub-45 and sub-30 at once, and the news is sub-30.
 */
export function earnedBy(progress: readonly TrackProgress[], solveId: string): (Earned & { track: Track })[] {
  const found: (Earned & { track: Track })[] = [];
  for (const track of progress) {
    for (const kind of KINDS) {
      const hits = track.rungs.map((rung) => rung[kind]).filter((e): e is Earned => e?.solveId === solveId);
      if (hits.length > 0) found.push({ ...hits.reduce((a, b) => (b.underMs < a.underMs ? b : a)), track: track.track });
    }
  }
  return found;
}

/** How many barriers of how many are broken, counting each kind separately. */
export function tally(progress: TrackProgress): { earned: number; total: number } {
  let earned = 0;
  for (const rung of progress.rungs) for (const kind of KINDS) if (rung[kind]) earned += 1;
  return { earned, total: progress.rungs.length * KINDS.length };
}

/**
 * A solve as history keeps it, read for milestones. A stopwatch time and a
 * smart-cube solve were both done on a real cube; only a keyboard solve is not.
 */
export function fromHistory(
  solves: readonly {
    id: string;
    at: number;
    durationMs: number;
    penalty: Penalty;
    source: "keyboard" | "smartcube" | "manual";
    event?: EventId;
  }[],
): MilestoneSolve[] {
  return solves.map((solve) => ({
    id: solve.id,
    at: solve.at,
    ms: solve.durationMs,
    penalty: solve.penalty,
    event: solve.event ?? "333",
    hand: solve.source === "keyboard" ? "keyboard" : "cube",
  }));
}

const KIND_NAMES: Record<Kind, string> = { single: "single", ao5: "average of 5", ao12: "average of 12" };

/** "Sub-20 average of 5". */
export function milestoneName(underMs: number, kind: Kind): string {
  return `${rungName(underMs)} ${KIND_NAMES[kind]}`;
}
