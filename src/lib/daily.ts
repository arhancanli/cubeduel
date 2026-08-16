import { formatMs } from "./format";
import type { Penalty } from "./types";

/**
 * The daily runs on UTC days, not local ones. Wordle uses local dates, which is
 * fine for a puzzle with no leaderboard — but a competitive round needs one
 * global window so every result is comparable and the reset is a single moment.
 */
export function utcDayKey(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export function msUntilNextUtcDay(now: Date = new Date()): number {
  const next = new Date(now);
  next.setUTCHours(24, 0, 0, 0);
  return next.getTime() - now.getTime();
}

/** Human countdown for "next scramble in ...". */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return `${hours}h ${minutes.toString().padStart(2, "0")}m ${seconds
    .toString()
    .padStart(2, "0")}s`;
}

/**
 * Today's day number. This is the integer the server stores results against, so
 * the one-attempt-per-day rule is a primary key rather than a promise — the
 * `localStorage` version it replaces reset whenever anyone cleared their storage.
 */
export function todayNumber(startKey: string): number {
  return dayNumber(startKey, utcDayKey());
}

/** 1-indexed day number, used for "daily #14". */
export function dayNumber(startKey: string, dayKey: string): number {
  const start = Date.parse(`${startKey}T00:00:00Z`);
  const day = Date.parse(`${dayKey}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(day)) return 0;
  return Math.floor((day - start) / 86_400_000) + 1;
}

/**
 * Speed tiers use the community's own vocabulary — "sub-15", "sub-20" — rather
 * than a percentile. A percentile would need a population we don't have yet, and
 * inventing one would make the share a lie. Fixed thresholds are honest today and
 * stay meaningful once there is a leaderboard.
 */
export const TIERS = [
  { maxMs: 10_000, label: "sub-10" },
  { maxMs: 15_000, label: "sub-15" },
  { maxMs: 20_000, label: "sub-20" },
  { maxMs: 30_000, label: "sub-30" },
  { maxMs: 60_000, label: "sub-60" },
] as const;

export const TIER_MAX = TIERS.length;

/** Filled blocks out of TIER_MAX. 0 means slower than a minute, or a DNF. */
export function speedTier(effective: number | null): number {
  if (effective === null) return 0;
  for (let i = 0; i < TIERS.length; i++) {
    if (effective < TIERS[i].maxMs) return TIER_MAX - i;
  }
  return 0;
}

export function tierLabel(effective: number | null): string {
  if (effective === null) return "DNF";
  const tier = TIERS.find((t) => effective < t.maxMs);
  return tier ? tier.label : "over a minute";
}

export interface DailyResult {
  dayKey: string;
  ms: number;
  penalty: Penalty;
  /** Whether the app watched the cube reach a solved state. */
  verified?: boolean;
}

function effectiveOf(result: DailyResult): number | null {
  if (result.penalty === "DNF") return null;
  return result.penalty === "PLUS2" ? result.ms + 2000 : result.ms;
}

/**
 * The share is the entire growth mechanic, so it has to survive being pasted
 * anywhere: no image, no link preview required, spoiler-free, and instantly
 * comparable between two friends.
 */
export function buildShareText(
  result: DailyResult,
  startKey: string,
  origin = "cubeduel.app",
): string {
  const effective = effectiveOf(result);
  const filled = speedTier(effective);
  const blocks = "\u{1F7E9}".repeat(filled) + "\u{2B1B}".repeat(TIER_MAX - filled);
  const time = effective === null ? "DNF" : formatMs(effective);
  const n = dayNumber(startKey, result.dayKey);

  // A verified solve was watched to completion by the app; a hand-timed one is the
  // player's own word. Saying which costs one character and is the difference
  // between a result and a claim.
  const mark = result.verified ? " \u2713" : "";
  return `cubeduel daily #${n}\n${blocks} ${time}${mark}\n${origin}/daily`;
}

/**
 * The shape of a solve, as blocks.
 *
 * The speed bar above says how fast. This says **where the time went**, and it is
 * the more interesting thing to paste into a group chat: two people who both got
 * 18 seconds with different shapes have something to argue about, and that
 * argument is the growth loop. It is also the one thing a timer cannot show and
 * this app can, so the share advertises the actual product rather than a number.
 *
 * Spoiler-free by construction: proportions reveal nothing about the scramble.
 *
 * Colours follow the phases as cubers picture them — cross on the bottom, F2L the
 * bulk of the solve, then the last layer in two steps.
 */
const PHASE_BLOCKS: { phase: string; block: string }[] = [
  { phase: "cross", block: "\u{1F7E6}" },
  { phase: "F2L", block: "\u{1F7E8}" },
  { phase: "OLL", block: "\u{1F7E9}" },
  { phase: "PLL", block: "\u{1F7EA}" },
];

/** Wide enough to show a shape, short enough to survive a phone's line width. */
export const SHAPE_WIDTH = 12;

/**
 * Structurally identical to `PhaseSplit` from the CFOP analysis, deliberately —
 * the caller passes its splits straight in with no adapter, so the two cannot
 * drift into disagreeing about which field holds the time.
 */
export interface PhaseShare {
  phase: string;
  durationMs: number;
}

/**
 * Allocates `SHAPE_WIDTH` blocks across the phases in proportion to time spent.
 *
 * Largest-remainder rather than rounding each independently, because independent
 * rounding does not add up: four phases rounded separately can produce 11 or 13
 * blocks, and a share whose width changes between people is not comparable, which
 * was the entire point of it.
 *
 * Every phase that took any time gets at least one block. A phase that rounds to
 * nothing still happened, and showing a solve as having no OLL would be a lie in
 * the one place people are looking closely.
 */
export function buildShapeBar(splits: readonly PhaseShare[]): string {
  const known = splits.filter(
    (s) => PHASE_BLOCKS.some((p) => p.phase === s.phase) && s.durationMs > 0,
  );
  if (known.length === 0) return "";

  const total = known.reduce((sum, s) => sum + s.durationMs, 0);
  if (total <= 0) return "";

  // One block each up front, then share out what is left by proportion.
  const spare = Math.max(0, SHAPE_WIDTH - known.length);
  const exact = known.map((s) => (s.durationMs / total) * spare);
  const counts = exact.map((n) => Math.floor(n));

  let remaining = spare - counts.reduce((a, b) => a + b, 0);
  const order = exact
    .map((n, i) => ({ i, frac: n - Math.floor(n) }))
    .sort((a, b) => b.frac - a.frac);
  for (let k = 0; remaining > 0; k++, remaining--) {
    counts[order[k % order.length].i] += 1;
  }

  return known
    .map((s, i) => {
      const block = PHASE_BLOCKS.find((p) => p.phase === s.phase)!.block;
      return block.repeat(counts[i] + 1);
    })
    .join("");
}

/**
 * The share, with the shape when there is one.
 *
 * A hand-timed solve has no move stream and therefore no splits, so it falls back
 * to the speed bar. That asymmetry is deliberate and points the right way: the
 * richer thing to share is the one the app can actually vouch for.
 */
export function buildDailyShare(
  result: DailyResult,
  startKey: string,
  splits: readonly PhaseShare[] = [],
  origin = "cubeduel.app",
): string {
  const effective = effectiveOf(result);
  const shape = effective === null ? "" : buildShapeBar(splits);
  if (!shape) return buildShareText(result, startKey, origin);

  const n = dayNumber(startKey, result.dayKey);
  const mark = result.verified ? " \u2713" : "";
  const legend = PHASE_BLOCKS.map((p) => p.phase).join(" \u00b7 ");

  return `cubeduel daily #${n} \u00b7 ${formatMs(effective!)}${mark}\n${shape}\n${legend}\n${origin}/daily`;
}

/**
 * How kind today's scramble is, as the optimal cross length minimised over all six
 * faces — what a colour-neutral solver would actually find.
 *
 * Across the 400 pre-generated dailies the mean is 4.83 moves and the range is 2–6,
 * so these bands are set from the real distribution rather than invented: roughly
 * the easiest 6%, the middle 77%, and the hardest 17%.
 */
export function crossDifficultyLabel(moves: number): string {
  if (moves <= 3) return "kind";
  if (moves <= 5) return "fair";
  return "awkward";
}
