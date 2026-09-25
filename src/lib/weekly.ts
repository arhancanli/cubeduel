import { effectiveMs, trimmedAverage, type Timed } from "./stats";

/**
 * The weekly competition: five scrambles, the same for everybody, one attempt
 * at each, ranked by the WCA average of five.
 *
 * A week is an ISO week in UTC — Monday 00:00 to the next Monday — named the
 * way ISO names it, "2026-W39". One reset for the whole world, like the daily.
 */

export const WEEKLY_ATTEMPTS = 5;

const DAY = 86_400_000;

/** The ISO week containing `at`, as "YYYY-Www". */
export function weekKey(at: number): string {
  const d = new Date(at);
  const day = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  // ISO: weeks start on Monday, and a week belongs to the year of its Thursday.
  const weekday = (new Date(day).getUTCDay() + 6) % 7; // Monday 0 … Sunday 6
  const thursday = day - weekday * DAY + 3 * DAY;
  const year = new Date(thursday).getUTCFullYear();
  const jan4 = Date.UTC(year, 0, 4);
  const jan4Weekday = (new Date(jan4).getUTCDay() + 6) % 7;
  const week1Monday = jan4 - jan4Weekday * DAY;
  const week = Math.floor((thursday - 3 * DAY - week1Monday) / (7 * DAY)) + 1;
  return `${year}-W${String(week).padStart(2, "0")}`;
}

export function isWeekKey(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/.test(value) && weekKey(weekStart(value)) === value;
}

/** Monday 00:00 UTC of the week, in ms. */
export function weekStart(key: string): number {
  const [yearText, weekText] = key.split("-W");
  const year = Number(yearText);
  const jan4 = Date.UTC(year, 0, 4);
  const jan4Weekday = (new Date(jan4).getUTCDay() + 6) % 7;
  return jan4 - jan4Weekday * DAY + (Number(weekText) - 1) * 7 * DAY;
}

/** The moment the week closes: the next Monday 00:00 UTC. */
export function weekEnd(key: string): number {
  return weekStart(key) + 7 * DAY;
}

/**
 * Whether a solve must stay hidden: a weekly solve, from a week not yet
 * closed. Its scramble is one of the five everybody else is still to solve,
 * so its page, its replay and its scramble all wait for Monday.
 */
export function isSealed(mode: string, solvedAt: number, now = Date.now()): boolean {
  return mode === "weekly" && now < weekEnd(weekKey(solvedAt));
}

export function previousWeek(key: string): string {
  return weekKey(weekStart(key) - DAY);
}

/** "22–28 Sep 2026" — how a person reads a week. */
export function weekLabel(key: string): string {
  const start = new Date(weekStart(key));
  const end = new Date(weekEnd(key) - DAY);
  const month = (d: Date) => d.toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" });
  const startText = start.getUTCMonth() === end.getUTCMonth() ? `${start.getUTCDate()}` : `${start.getUTCDate()} ${month(start)}`;
  return `${startText}–${end.getUTCDate()} ${month(end)} ${end.getUTCFullYear()}`;
}

export interface Competitor {
  handle: string;
  displayName: string;
  /** In attempt order. Fewer than five while still competing. */
  results: Timed[];
}

export interface Placed extends Competitor {
  /** Shared by exact ties, as the WCA shares them. */
  place: number;
  averageMs: number | null;
  bestMs: number | null;
}

/**
 * Everybody who finished all five, ranked. By the average first, a DNF average
 * after every real one; then by the best single, which is how the WCA breaks a
 * tie; an exact tie on both shares the place. Somebody still competing is not
 * ranked — a partial average is not an average.
 */
export function rankWeekly(competitors: readonly Competitor[]): Placed[] {
  const finished = competitors
    .filter((c) => c.results.length === WEEKLY_ATTEMPTS)
    .map((c) => {
      const average = trimmedAverage(c.results, WEEKLY_ATTEMPTS);
      const singles = c.results.map(effectiveMs).filter((ms): ms is number => ms !== null);
      return {
        ...c,
        averageMs: average.kind === "value" ? average.ms : null,
        bestMs: singles.length > 0 ? Math.floor(Math.min(...singles) / 10) * 10 : null,
      };
    });

  const key = (c: { averageMs: number | null; bestMs: number | null }) =>
    [c.averageMs ?? Infinity, c.bestMs ?? Infinity] as const;
  finished.sort((a, b) => {
    const [aa, ab] = key(a);
    const [ba, bb] = key(b);
    return aa !== ba ? aa - ba : ab !== bb ? ab - bb : a.handle.localeCompare(b.handle);
  });

  let place = 0;
  return finished.map((c, i) => {
    const prev = finished[i - 1];
    const tied = prev !== undefined && prev.averageMs === c.averageMs && prev.bestMs === c.bestMs;
    if (!tied) place = i + 1;
    return { ...c, place };
  });
}
