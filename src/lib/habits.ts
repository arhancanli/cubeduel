import type { MomentKind, MoveReview } from "./moveReview";

/**
 * Insights: the review of one solve, rolled up across many.
 *
 * A single review says where one solve lost time. Whether that was a habit or
 * an accident only shows across solves: one long stop before the third pair is
 * a bad moment, the same stop in seven solves of ten is the thing to practise.
 *
 * Habits are ranked by time per solve — how much they cost, averaged over every
 * solve reviewed, including the ones where they did not happen. That is the
 * figure a fix would actually return, and it weighs a small habit you have every
 * time against a big one you have once a month on the same scale.
 *
 * Like the review itself, every figure is in the player's own currency, and
 * nothing is claimed from fewer than `MIN_REVIEWED` solves.
 */

export interface ReviewedSolve {
  durationMs: number;
  review: MoveReview;
}

export type HabitKind = "cross" | "pauses" | "undo" | "cancel" | "long-way" | "rotations" | "two-look";

export interface Habit {
  kind: HabitKind;
  title: string;
  /** The measured fact behind it, with the sample stated. */
  evidence: string;
  advice: string;
  /** Mean cost per reviewed solve, including solves without it. */
  perSolveMs: number;
  /** Fraction of reviewed solves it appeared in. */
  share: number;
  href?: string;
  action?: string;
  /** Index into the solves given of the one where this habit cost the most. */
  worst: number;
}

export type Insights =
  | { kind: "insufficient"; solves: number }
  | {
      kind: "insights";
      solves: number;
      meanDurationMs: number;
      recoverablePerSolveMs: number;
      habits: Habit[];
    };

export const MIN_REVIEWED = 5;
/** A habit is shown if it costs this much per solve on average… */
export const MIN_PER_SOLVE_MS = 100;
/** …or turns up in at least this share of solves. */
export const MIN_SHARE = 0.2;

const KIND_OF: Partial<Record<MomentKind, HabitKind>> = {
  "cross-route": "cross",
  pause: "pauses",
  undo: "undo",
  cancel: "cancel",
  "long-way": "long-way",
  rotations: "rotations",
  "two-look": "two-look",
};

function mostCommon(values: string[]): [string, number] | null {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: [string, number] | null = null;
  for (const entry of counts) if (!best || entry[1] > best[1]) best = entry;
  return best;
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(2)}s`;
}

export function insightsFrom(solves: readonly ReviewedSolve[]): Insights {
  const n = solves.length;
  if (n < MIN_REVIEWED) return { kind: "insufficient", solves: n };

  const cost = new Map<HabitKind, number>();
  const seenIn = new Map<HabitKind, number>();
  const worstAt = new Map<HabitKind, { index: number; ms: number }>();
  solves.forEach(({ review }, index) => {
    const here = new Map<HabitKind, number>();
    for (const m of review.moments) {
      const kind = KIND_OF[m.kind];
      if (!kind) continue;
      cost.set(kind, (cost.get(kind) ?? 0) + m.costMs);
      here.set(kind, (here.get(kind) ?? 0) + m.costMs);
    }
    for (const [kind, ms] of here) {
      seenIn.set(kind, (seenIn.get(kind) ?? 0) + 1);
      const worst = worstAt.get(kind);
      if (!worst || ms > worst.ms) worstAt.set(kind, { index, ms });
    }
  });

  const moments = solves.flatMap((s) => s.review.moments);
  const habits: Habit[] = [];

  for (const [kind, total] of cost) {
    const perSolveMs = total / n;
    const affected = seenIn.get(kind) ?? 0;
    const share = affected / n;
    if (perSolveMs < MIN_PER_SOLVE_MS && share < MIN_SHARE) continue;
    const base = { kind, perSolveMs, share, worst: worstAt.get(kind)?.index ?? 0 };
    const inSolves = `${affected} of ${n} solves`;

    if (kind === "pauses") {
      const pauses = moments.filter((m) => m.kind === "pause" && m.subject);
      const where = mostCommon(pauses.map((m) => `${m.opensPhase ? "before" : "in"} ${m.subject}`));
      const solvesAt = where
        ? solves.filter((s) =>
            s.review.moments.some(
              (m) => m.kind === "pause" && `${m.opensPhase ? "before" : "in"} ${m.subject}` === where[0],
            ),
          ).length
        : affected;
      const before = where?.[0].startsWith("before");
      habits.push({
        ...base,
        title: where ? `You stop ${where[0]}` : "Long stops mid-solve",
        evidence: where
          ? `A long pause ${where[0]} in ${solvesAt} of ${n} solves; pauses cost ${seconds(perSolveMs)} a solve in all.`
          : `Long pauses in ${inSolves}, ${seconds(perSolveMs)} a solve.`,
        advice: before
          ? "That pause is recognition happening after the last step instead of during it. While your hands finish the previous step, let your eyes find the next pieces — slow the turning down if that is what it takes. Solving slower and never stopping beats solving fast in bursts."
          : "The hands stopped in the middle of a step, which usually means a piece was lost or the plan changed. Replay those solves and watch what the cube looked like just before.",
      });
    } else if (kind === "cross") {
      const known = moments.filter((m) => m.kind === "cross-route" || m.kind === "cross-clean");
      const extra = known.reduce((sum, m) => sum + (m.extraTurns ?? 0), 0) / Math.max(1, known.length);
      habits.push({
        ...base,
        title: "Your cross runs long",
        evidence: `On average ${extra.toFixed(1)} turns over the shortest cross on the same face, across ${known.length} solves.`,
        advice:
          "Plan the whole cross in inspection, not the first two edges. Each review shows the shortest route for that scramble — try building it from the review before your next solve.",
        href: "/play",
        action: "Practise on the keyboard",
      });
    } else if (kind === "two-look") {
      const cases = mostCommonList(
        moments.filter((m) => m.kind === "two-look" && m.subject).map((m) => ({ key: m.subject!, href: m.href })),
      );
      const top = cases[0];
      habits.push({
        ...base,
        title: "Some last-layer cases take you two looks",
        evidence: `${cases
          .slice(0, 3)
          .map((c) => `${c.key} (${c.count}×)`)
          .join(", ")} — ${seconds(perSolveMs)} a solve.`,
        advice: "Each of these has a single algorithm. Learn the one you meet most first; the rest can wait.",
        href: top?.href,
        action: top ? `Learn ${top.key}` : undefined,
      });
    } else if (kind === "undo") {
      habits.push({
        ...base,
        title: "You undo turns",
        evidence: `Turns undone in ${inSolves}, ${seconds(perSolveMs)} a solve.`,
        advice: "Usually a misread piece. Look one turn further before you start moving.",
      });
    } else if (kind === "cancel") {
      habits.push({
        ...base,
        title: "Your algorithms undo each other at the seams",
        evidence: `One step ends on the turn the next one starts by undoing, in ${inSolves}.`,
        advice:
          "Not a mistake — the next case just was not recognised in time to leave both turns out. Recognise the next case while the current algorithm finishes, and the last turn of one and the first of the next can both be skipped.",
      });
    } else if (kind === "rotations") {
      habits.push({
        ...base,
        title: "You rotate the cube during F2L",
        evidence: `Two or more rotations in ${inSolves}.`,
        advice:
          "Every rotation is a regrip and a fresh look. Solving back-slot pairs from where they sit, instead of turning the cube to face them, removes most of them.",
      });
    } else if (kind === "long-way") {
      habits.push({
        ...base,
        title: "Three turns where one would do",
        evidence: `R R R instead of R' in ${inSolves}.`,
        advice: "Three quarter turns one way are one quarter turn the other.",
      });
    }
  }

  habits.sort((a, b) => b.perSolveMs - a.perSolveMs);
  const meanDurationMs = solves.reduce((sum, s) => sum + s.durationMs, 0) / n;
  const recoverablePerSolveMs = solves.reduce((sum, s) => sum + s.review.recoverableMs, 0) / n;
  return { kind: "insights", solves: n, meanDurationMs, recoverablePerSolveMs, habits };
}

function mostCommonList(items: { key: string; href?: string }[]): { key: string; href?: string; count: number }[] {
  const counts = new Map<string, { key: string; href?: string; count: number }>();
  for (const item of items) {
    const entry = counts.get(item.key) ?? { ...item, count: 0 };
    entry.count += 1;
    counts.set(item.key, entry);
  }
  return [...counts.values()].sort((a, b) => b.count - a.count);
}
