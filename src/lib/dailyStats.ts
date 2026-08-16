import type { DailyEntry } from "./dailyStorage";

/**
 * The daily's memory.
 *
 * Until now an attempt ended in a time and nothing else: no number moved, nothing
 * accumulated, and there was nothing at stake tomorrow. Every day's result was
 * already sitting on disk — it was simply never read back.
 *
 * The streak is deliberately forgiving. It only breaks once a whole day has passed
 * with no attempt, so today being unplayed does not threaten you until midnight.
 * A streak that punishes you at the moment you open the page is a hostage
 * mechanic; one that records what you did is a record.
 *
 * A DNF still counts as a day played. You turned up.
 */

export interface DailyDay {
  dayKey: string;
  /** Null when the day was not attempted. */
  ms: number | null;
  dnf: boolean;
  verified: boolean;
}

export interface DailyStats {
  played: number;
  currentStreak: number;
  bestStreak: number;
  /** Fastest finished daily, ignoring DNFs. */
  bestMs: number | null;
  /** The most recent finished day before today, for "yesterday you did X". */
  previous: DailyDay | null;
  /** Most recent `window` days, oldest first, including days not attempted. */
  recent: DailyDay[];
}

function shiftDay(dayKey: string, by: number): string {
  const date = new Date(`${dayKey}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + by);
  return date.toISOString().slice(0, 10);
}

function toDay(dayKey: string, entry: DailyEntry | undefined): DailyDay | null {
  if (!entry || entry.status !== "done") return null;
  return {
    dayKey,
    ms: entry.penalty === "DNF" ? null : entry.ms,
    dnf: entry.penalty === "DNF",
    verified: entry.verified,
  };
}

export function computeDailyStats(
  entries: Record<string, DailyEntry>,
  todayKey: string,
  window = 14,
): DailyStats {
  const finished = Object.entries(entries)
    .filter(([, e]) => e.status === "done")
    .map(([dayKey]) => dayKey)
    .sort();

  const playedSet = new Set(finished);

  // Count back from today, or from yesterday when today is not played yet — a
  // streak should not read as broken merely because the day is still young.
  let cursor = playedSet.has(todayKey) ? todayKey : shiftDay(todayKey, -1);
  let currentStreak = 0;
  while (playedSet.has(cursor)) {
    currentStreak += 1;
    cursor = shiftDay(cursor, -1);
  }

  let bestStreak = 0;
  let run = 0;
  let expected: string | null = null;
  for (const dayKey of finished) {
    run = expected !== null && dayKey === expected ? run + 1 : 1;
    bestStreak = Math.max(bestStreak, run);
    expected = shiftDay(dayKey, 1);
  }

  const times = finished
    .map((k) => toDay(k, entries[k]))
    .filter((d): d is DailyDay => d !== null && d.ms !== null)
    .map((d) => d.ms!);

  const previousKey = finished.filter((k) => k < todayKey).pop();

  const recent: DailyDay[] = [];
  for (let i = window - 1; i >= 0; i--) {
    const dayKey = shiftDay(todayKey, -i);
    recent.push(
      toDay(dayKey, entries[dayKey]) ?? { dayKey, ms: null, dnf: false, verified: false },
    );
  }

  return {
    played: finished.length,
    currentStreak,
    bestStreak: Math.max(bestStreak, currentStreak),
    bestMs: times.length > 0 ? Math.min(...times) : null,
    previous: previousKey ? toDay(previousKey, entries[previousKey]) : null,
    recent,
  };
}

/** True when a day in `recent` was never attempted, as opposed to attempted and DNF'd. */
export function wasAttempted(day: DailyDay): boolean {
  return day.ms !== null || day.dnf;
}
