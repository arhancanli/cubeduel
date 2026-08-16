import { trimmedAverage, type Timed } from "./stats";

/**
 * The rating.
 *
 * Chess ratings exist because chess has no absolute scale — you only ever learn
 * that one player beat another, and Elo reconstructs a scale out of thousands of
 * those comparisons. Cubing is not like that. Skill here is directly measurable in
 * seconds, on the same scale for everyone, with no opponent required.
 *
 * So this is deliberately **not** Elo. Pretending we need pairwise comparisons
 * when we have direct measurements would throw away information and produce a
 * number nobody could interpret. What a rating still buys us over just printing an
 * average is four things, and each one is a real problem:
 *
 * 1. **Comparability across events.** 20 seconds is slow for 3x3 and extraordinary
 *    for 5x5. One scale, calibrated per event, makes a profile readable at a glance.
 * 2. **Uncertainty.** An average over five solves and an average over five hundred
 *    are not the same claim. The rating carries a deviation, and the leaderboard
 *    only admits players whose deviation is small enough to mean something.
 * 3. **Recency.** A rating tracks what you can do now. An all-time average does not.
 * 4. **Un-farmable results.** See the DNF rule below.
 *
 * ## The scale
 *
 * Cubers improve multiplicatively — 30s to 20s is the same size of achievement as
 * 15s to 10s — so the scale is linear in log time. Two anchors fix it, both chosen
 * because they are landmarks the sport already recognises:
 *
 *     a 5 second average  = 3000   (world class)
 *     a 15 second average = 2000   (the classic "sub-15" line)
 *
 * Everything else follows: sub-20 is ~1740, sub-30 ~1370, a minute ~740, and the
 * floor of 100 lands near two minutes. Because the transform is exact and
 * invertible, every rating can be shown alongside the time it means. A rating you
 * cannot translate back into seconds would be a worse number than the seconds.
 *
 * ## What gets rated
 *
 * Not single solves. A single solve contains a PLL skip or a lockup, and neither is
 * skill. The unit is a **window of five ranked attempts, averaged by WCA rules** —
 * the same trimmed ao5 the sport uses, computed by the same tested code path in
 * `stats.ts`. Reusing it rather than writing a parallel average is the point: there
 * is exactly one definition of "average" in this app, and cubers already trust it.
 *
 * ## DNFs, and why they are uncertainty rather than a penalty
 *
 * A rating that ignored failed attempts could be farmed trivially: abandon every
 * attempt that starts badly and rate only the good ones. So DNFs have to count.
 *
 * But rating a DNF as a *time* means inventing a number — there is no evidence in a
 * failed attempt about how fast the player is. What a failed window actually tells
 * us is that we know **less** than we thought, and that is exactly what a widened
 * deviation encodes. So two or more DNFs in a window (a DNF ao5 under WCA trimming)
 * leaves the rating untouched and widens the deviation.
 *
 * This closes the exploit properly rather than approximately. Abandoning attempts
 * can never raise a rating, and doing it repeatedly widens the deviation until the
 * player drops off the leaderboard for being unestablished. No fabricated time
 * appears anywhere.
 */

// ---------------------------------------------------------------------------
// The scale
// ---------------------------------------------------------------------------

export const ANCHOR_FAST_SECONDS = 5;
export const ANCHOR_FAST_RATING = 3000;
export const ANCHOR_MID_SECONDS = 15;
export const ANCHOR_MID_RATING = 2000;

/**
 * Rating points per natural-log-second. Derived from the two anchors rather than
 * typed in, so moving an anchor cannot silently leave the scale inconsistent.
 */
export const SCALE_K =
  (ANCHOR_FAST_RATING - ANCHOR_MID_RATING) /
  Math.log(ANCHOR_MID_SECONDS / ANCHOR_FAST_SECONDS);

/**
 * Ratings do not go below this. Without a floor the log scale runs negative for
 * very slow times, and "-260" is not something to show a beginner on their first
 * day. Times slower than the floor all read as the floor, which is honest: below
 * this point the number has stopped discriminating.
 */
export const RATING_FLOOR = 100;

/**
 * The scale needs a ceiling as much as a floor, and for a sharper reason: the log
 * runs to infinity as the time approaches zero, so a corrupt record of 0ms rated
 * five figures and would have sat permanently at the top of every board. A floor
 * alone protects the beginner and leaves the leaderboard wide open.
 *
 * One second is the bound because it is unarguable rather than because it is
 * tuned — a 3x3 solve is at least ~20 moves, so a one-second *average* is not a
 * fast human, it is a broken clock. Verification is what should actually catch
 * these; this is the backstop that makes the function total no matter what
 * reaches it.
 */
export const MIN_PLAUSIBLE_MS = 1000;

/** The rating a given average time is worth. */
export function ratingForMs(ms: number): number {
  const seconds = Math.max(ms, MIN_PLAUSIBLE_MS) / 1000;
  const raw =
    ANCHOR_FAST_RATING - SCALE_K * Math.log(seconds / ANCHOR_FAST_SECONDS);
  return Math.max(RATING_FLOOR, raw);
}

/** Nothing can rate above this, however corrupt the record. */
export const RATING_CEILING =
  ANCHOR_FAST_RATING -
  SCALE_K * Math.log(MIN_PLAUSIBLE_MS / 1000 / ANCHOR_FAST_SECONDS);

/**
 * The average time a rating means — the inverse of `ratingForMs`, and the reason
 * the UI can always print "2000 (sub-15)".
 *
 * Not invertible at the floor: every time slower than ~2 minutes maps to 100, so
 * `ratingForMs(msForRating(100))` is 100 but the time does not round-trip. That is
 * the floor doing its job, not a bug.
 */
export function msForRating(rating: number): number {
  const seconds =
    ANCHOR_FAST_SECONDS * Math.exp((ANCHOR_FAST_RATING - rating) / SCALE_K);
  return seconds * 1000;
}

// ---------------------------------------------------------------------------
// The filter
// ---------------------------------------------------------------------------

/**
 * Deviation of a player who has never been rated. Wide enough that the first
 * window essentially sets the rating outright — a sub-10 cuber should not have to
 * grind fifty solves to climb out of a fictional starting value the way a new
 * chess account does. Chess has to start you somewhere arbitrary because it cannot
 * measure you directly. We can.
 */
export const INITIAL_DEVIATION = 350;

/**
 * Nobody's speed is knowable to better than this. Solve times move with sleep,
 * lighting, a stiff puzzle and mood; claiming ±20 would be false precision.
 */
export const MIN_DEVIATION = 35;
export const MAX_DEVIATION = 350;

/**
 * Leaderboard eligibility. Reached after about four clean windows (20 ranked
 * solves) — enough that a placing means something, few enough that it is a single
 * session's work.
 */
export const ESTABLISHED_DEVIATION = 60;

/**
 * How fast certainty decays while a player is away, in rating points of standard
 * deviation per day. People improve and people rust; a rating from three months
 * ago is a weaker claim than the same rating from yesterday, and the deviation has
 * to say so or the leaderboard slowly fills with ghosts.
 */
export const DRIFT_PER_DAY = 12;

/**
 * Spread between sessions that is not captured by spread within a session. A
 * player's five solves this evening agree with each other more than they agree
 * with next Tuesday's five, and a filter that ignored that would become confident
 * far too quickly.
 */
export const BETWEEN_SESSION_NOISE = 60;

/** Floor on the within-window component, for a window that happens to be uncannily tight. */
export const MIN_WITHIN_NOISE = 45;

/** Used until a window has enough finite times to estimate spread from. */
export const DEFAULT_WITHIN_NOISE = 90;

/** How much a failed window widens the deviation. */
export const DNF_UNCERTAINTY = 80;

/** Ranked attempts per rated window. The WCA ao5. */
export const WINDOW_SIZE = 5;

export interface RatingState {
  /** `null` until the first window lands. There is no fictional starting rating. */
  rating: number | null;
  deviation: number;
  /** Rated windows applied, failed ones included. */
  windowCount: number;
  /** Highest established rating ever held. Provisional spikes do not qualify. */
  peak: number | null;
  /** Epoch ms of the last rated window, for the drift calculation. */
  lastRatedAt: number | null;
}

export const UNRATED: RatingState = {
  rating: null,
  deviation: INITIAL_DEVIATION,
  windowCount: 0,
  peak: null,
  lastRatedAt: null,
};

/** Whether this rating is solid enough to be ranked publicly. */
export function isEstablished(state: RatingState): boolean {
  return state.rating !== null && state.deviation <= ESTABLISHED_DEVIATION;
}

function clampDeviation(deviation: number): number {
  return Math.min(MAX_DEVIATION, Math.max(MIN_DEVIATION, deviation));
}

/**
 * Widen the deviation for time passed since the last rated window. Applied before
 * every update, so a player returning after a long break is correctly treated as
 * someone we are no longer sure about.
 */
function withDrift(state: RatingState, now: number): number {
  if (state.lastRatedAt === null) return state.deviation;
  const days = Math.max(0, (now - state.lastRatedAt) / 86_400_000);
  return clampDeviation(
    Math.sqrt(state.deviation ** 2 + DRIFT_PER_DAY ** 2 * days),
  );
}

/**
 * How noisy this particular window's estimate is, in rating points.
 *
 * Estimated from the player's own solves rather than assumed: a metronomic cuber
 * earns a tighter deviation than a streaky one from the same number of solves,
 * which is the correct result. The within-session part is divided by sqrt(3)
 * because a trimmed ao5 averages the three solves it keeps.
 */
export function observationNoise(attempts: readonly Timed[]): number {
  const points = attempts
    .filter((a) => a.penalty !== "DNF")
    .map((a) => ratingForMs(a.ms + (a.penalty === "PLUS2" ? 2000 : 0)));

  let within = DEFAULT_WITHIN_NOISE;
  if (points.length >= 3) {
    const mean = points.reduce((a, b) => a + b, 0) / points.length;
    const variance =
      points.reduce((sum, p) => sum + (p - mean) ** 2, 0) / (points.length - 1);
    within = Math.max(MIN_WITHIN_NOISE, Math.sqrt(variance) / Math.sqrt(3));
  }

  return Math.sqrt(within ** 2 + BETWEEN_SESSION_NOISE ** 2);
}

export interface WindowOutcome {
  state: RatingState;
  /** The ao5 that was rated, or `null` when the window failed. */
  averageMs: number | null;
  /** What the window on its own was worth, before being blended with the prior. */
  observedRating: number | null;
  failed: boolean;
}

/**
 * Apply one window of ranked attempts.
 *
 * The update is the standard normal-normal conjugate step: the prior and the
 * observation are combined in inverse-variance proportion, so a confident rating
 * moves little on one window and a fresh one moves a lot. That is the same
 * behaviour Glicko's RD produces, arrived at directly because our observation is a
 * measurement rather than a win or a loss.
 */
export function applyWindow(
  state: RatingState,
  attempts: readonly Timed[],
  now: number,
): WindowOutcome {
  // A short window is a caller bug, not a rating event. Silently rating four
  // attempts as an ao5 would quietly change what the number means.
  if (attempts.length !== WINDOW_SIZE) {
    return { state, averageMs: null, observedRating: null, failed: false };
  }

  const deviation = withDrift(state, now);
  const average = trimmedAverage([...attempts], WINDOW_SIZE);

  // Too many DNFs to trim: no evidence about speed, so widen rather than invent.
  if (average.kind !== "value") {
    return {
      state: {
        ...state,
        deviation: clampDeviation(
          Math.sqrt(deviation ** 2 + DNF_UNCERTAINTY ** 2),
        ),
        windowCount: state.windowCount + 1,
        lastRatedAt: now,
      },
      averageMs: null,
      observedRating: null,
      failed: true,
    };
  }

  const observed = ratingForMs(average.ms);
  const tau = observationNoise(attempts);

  // With no prior rating the prior mean is the observation itself, which is the
  // flat-prior case written so it needs no special branch downstream.
  const priorMean = state.rating ?? observed;

  const priorPrecision = 1 / deviation ** 2;
  const observationPrecision = 1 / tau ** 2;
  const posteriorPrecision = priorPrecision + observationPrecision;

  const rating =
    (priorMean * priorPrecision + observed * observationPrecision) /
    posteriorPrecision;
  const posteriorDeviation = clampDeviation(1 / Math.sqrt(posteriorPrecision));

  const next: RatingState = {
    rating,
    deviation: posteriorDeviation,
    windowCount: state.windowCount + 1,
    // A peak is a claim about what someone has actually demonstrated, so an
    // unestablished rating cannot set one. Otherwise a single fluke window would
    // leave a permanent number on the profile that nothing could ever justify.
    peak:
      posteriorDeviation <= ESTABLISHED_DEVIATION
        ? Math.max(state.peak ?? rating, rating)
        : state.peak,
    lastRatedAt: now,
  };

  return {
    state: next,
    averageMs: average.ms,
    observedRating: observed,
    failed: false,
  };
}

/**
 * Which ladder a solve belongs to.
 *
 * Keyboard cubing and hand cubing produce times that are not remotely comparable,
 * so they are separate ladders rather than one ladder with a filter. `manual`
 * returns null: a stopwatch time has no move stream behind it, cannot be verified,
 * and therefore cannot be ranked.
 */
export type RatingPool = "keyboard" | "smartcube";

export function poolForSource(source: string): RatingPool | null {
  if (source === "keyboard") return "keyboard";
  if (source === "smartcube") return "smartcube";
  return null;
}

/** Display form: the integer players quote, and the ± they should read it with. */
export function formatRating(state: RatingState): string {
  if (state.rating === null) return "unrated";
  return String(Math.round(state.rating));
}
