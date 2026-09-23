/**
 * The solving streak: consecutive days with at least one solve.
 *
 * The daily's streak runs on UTC days, because it is one shared puzzle with one
 * reset for the whole world. This one is about the player's own practice, so it
 * runs on their own days — solving at 11pm and again at 1am is two days to them,
 * and it should be two days here.
 *
 * Forgiving in the same way as the daily's: it only breaks once a whole day has
 * passed with no solve. Opening the site at breakfast must not tell you your
 * streak is gone; it is not gone until tonight is over.
 */

export interface Streak {
  current: number;
  best: number;
  /** Whether today already counts. */
  today: boolean;
  /** The last fourteen days, oldest first, today last: solved or not. */
  recent: boolean[];
}

export const RECENT_DAYS = 14;

/** A local calendar day as YYYY-MM-DD. */
export function localDayKey(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** The local day `by` days from the one containing `ms`, as a key. */
function shift(ms: number, by: number): string {
  const d = new Date(ms);
  // setDate handles month and year ends; noon keeps it clear of DST edges.
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + by);
  return localDayKey(d.getTime());
}

export function solvingStreak(timestamps: readonly number[], now: Date = new Date()): Streak {
  const days = new Set(timestamps.map(localDayKey));
  const nowMs = now.getTime();
  const todayKey = localDayKey(nowMs);
  const today = days.has(todayKey);

  let current = 0;
  let offset = today ? 0 : -1;
  while (days.has(shift(nowMs, offset))) {
    current += 1;
    offset -= 1;
  }

  const sorted = [...days].sort();
  let best = 0;
  let run = 0;
  let expected: string | null = null;
  for (const key of sorted) {
    const noon = new Date(`${key}T12:00:00`).getTime();
    run = expected !== null && key === expected ? run + 1 : 1;
    best = Math.max(best, run);
    expected = shift(noon, 1);
  }

  const recent: boolean[] = [];
  for (let i = RECENT_DAYS - 1; i >= 0; i--) recent.push(days.has(shift(nowMs, -i)));

  return { current, best, today, recent };
}
