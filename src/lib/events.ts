/**
 * The events this platform rates, and what a rating means on each of them.
 *
 * The schema has been keyed by event since the first migration, but only 3x3 was
 * ever wired up. Every other cubing site supports a spread of puzzles, and being
 * 3x3-only was the clearest gap between this and the things people already use.
 *
 * ## Why each event needs its own anchors
 *
 * The rating is linear in log time, fixed to two landmarks. For 3x3 those are a
 * 5 second average (3000) and a 15 second average (2000), and the ratio of three
 * between them is what gives the tidy "a thousand points is three times slower".
 *
 * That ratio is a property of 3x3, not a law. Big cubes compress: the gap between
 * a world-class 5x5 and a competent one is nothing like a factor of three,
 * because a much larger share of the solve is unavoidable mechanical work that
 * nobody can skip. Forcing the same ratio everywhere would mean 2000 on 5x5
 * landed on a beginner, and a cross-event leaderboard would be comparing a
 * world-class 3x3 to a mediocre 5x5.
 *
 * So each event fixes its own two landmarks, and the property that holds
 * everywhere is the one that actually matters:
 *
 *     3000  world class — roughly the standard of a national final
 *     2000  strong club cuber — visibly good, not competitive at the top
 *
 * The numbers below are set against real WCA results rather than picked to look
 * neat. World records for the average, at the time of writing: 2x2 0.86s, 3x3
 * ~4.0s, 4x4 18.56s, 5x5 33.73s. "World class" sits a little back from the
 * record, because a scale whose top mark only one person on earth can reach
 * tells everybody else nothing.
 */

export const EVENT_IDS = ["222", "333", "444", "555"] as const;
export type EventId = (typeof EVENT_IDS)[number];

export interface EventDef {
  id: EventId;
  /** Shown to players. */
  name: string;
  /** Longer form, for headings and page titles. */
  longName: string;
  /** The `cubing/puzzles` key this replays and verifies against. */
  puzzle: "2x2x2" | "3x3x3" | "4x4x4" | "5x5x5";
  /** An average of five at this many milliseconds rates 3000. */
  worldClassMs: number;
  /** An average of five at this many milliseconds rates 2000. */
  strongMs: number;
  /**
   * Below this, an *average* is treated as impossible rather than fast.
   * Guards the log scale, which runs to infinity as time approaches zero — a
   * single corrupt 0ms record would otherwise sit permanently at the top of
   * every board.
   */
  minPlausibleMs: number;
  /**
   * Below this, a *single solve* is refused by verification.
   *
   * Deliberately separate from `minPlausibleMs`, and much lower. That one bounds
   * an average of five; this one bounds one solve, and a single can be far faster
   * than any average — the 2x2 world record single is 0.39s against a 0.86s
   * record average. A shared floor would have to be set low enough for the
   * fastest single, which would leave the rating scale wide open, or high enough
   * for the scale, which would reject world records as cheating.
   */
  minSolveMs: number;
}

export const EVENTS: Record<EventId, EventDef> = {
  // WR average 0.86s. A 2 second average is a serious 2x2 solver; 6 seconds is
  // a competent one. The spread is wide in relative terms because a 2x2 solve is
  // mostly recognition, and recognition is where the skill gap shows.
  "222": {
    id: "222",
    name: "2x2",
    longName: "2x2x2",
    puzzle: "2x2x2",
    worldClassMs: 2_000,
    strongMs: 6_000,
    minPlausibleMs: 400,
    // WR single 0.39s, so this must sit below it.
    minSolveMs: 250,
  },

  // The original scale, unchanged: 5s = 3000, 15s = 2000.
  "333": {
    id: "333",
    name: "3x3",
    longName: "3x3x3",
    puzzle: "3x3x3",
    worldClassMs: 5_000,
    strongMs: 15_000,
    minPlausibleMs: 1_000,
    // unchanged: WR single ~3.0s, so 0.5s is unarguable.
    minSolveMs: 500,
  },

  // WR average 18.56s. 25 seconds is a national-final standard; 55 seconds is a
  // strong club solver. Closer together than 3x3 in ratio terms, which is the
  // whole reason these are per-event.
  "444": {
    id: "444",
    name: "4x4",
    longName: "4x4x4",
    puzzle: "4x4x4",
    worldClassMs: 25_000,
    strongMs: 55_000,
    minPlausibleMs: 8_000,
    // WR single 15.18s.
    minSolveMs: 5_000,
  },

  // WR average 33.73s. Compresses further again.
  "555": {
    id: "555",
    name: "5x5",
    longName: "5x5x5",
    puzzle: "5x5x5",
    worldClassMs: 45_000,
    strongMs: 95_000,
    minPlausibleMs: 15_000,
    // WR single 29.49s.
    minSolveMs: 10_000,
  },
};

export const DEFAULT_EVENT: EventId = "333";

export function isEventId(value: unknown): value is EventId {
  return typeof value === "string" && (EVENT_IDS as readonly string[]).includes(value);
}

/** The event, or the default — never undefined, so callers cannot forget. */
export function eventOf(value: unknown): EventDef {
  return EVENTS[isEventId(value) ? value : DEFAULT_EVENT];
}

/**
 * Whether this app can tell you how efficient your solve was.
 *
 * The solver is Kociemba's two-phase algorithm, which is specific to 3x3 — it is
 * built on 3x3's coordinates and its group structure, and none of that
 * generalises. Big cubes are solved by reduction, which is a different program
 * entirely. Rather than pretend, the move-efficiency feature is simply absent on
 * events it cannot answer for, and the UI says why.
 */
export function hasSolver(event: EventId): boolean {
  return event === "333";
}

/**
 * The puzzle a synced solve says it was. Absent means 3x3 — every client before
 * the timer timed anything else sent none. Anything unrecognised is refused
 * rather than guessed: storing it as a 3x3 would put a stranger's number in
 * somebody's 3x3 history.
 */
export function parseSyncedEvent(value: unknown): EventId | null {
  if (value === undefined) return "333";
  return typeof value === "string" && (EVENT_IDS as readonly string[]).includes(value) ? (value as EventId) : null;
}
