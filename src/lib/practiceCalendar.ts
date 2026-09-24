import { localDayKey } from "./streak";

/**
 * The last few months of practice, a square a day.
 *
 * The streak says how many days in a row; this says what the months looked
 * like — the week you missed, the weekend you did two hundred. Days are the
 * solver's own, as the streak's are, and weeks run Monday to Sunday.
 */

export interface CalendarDay {
  key: string;
  count: number;
  level: 0 | 1 | 2 | 3 | 4;
  today: boolean;
  /** Later this week: drawn empty, never counted. */
  future: boolean;
}

export interface PracticeCalendar {
  /** Oldest week first; each Monday to Sunday. */
  weeks: CalendarDay[][];
  /** A label over the first week holding each month's first day. */
  months: { label: string; week: number }[];
  /** Days with at least one solve, in the window. */
  days: number;
  solves: number;
}

/**
 * Fixed steps rather than steps relative to your busiest day: relative ones
 * would make one enormous Saturday turn every ordinary day pale, and the same
 * twenty solves would look different from one month to the next.
 */
export function levelFor(count: number): CalendarDay["level"] {
  if (count <= 0) return 0;
  if (count < 5) return 1;
  if (count < 15) return 2;
  if (count < 30) return 3;
  return 4;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Noon on the local day `by` days from `base`: noon keeps clear of clock changes. */
function dayFrom(base: Date, by: number): Date {
  const d = new Date(base);
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + by);
  return d;
}

export function practiceCalendar(
  timestamps: readonly number[],
  now: Date = new Date(),
  weekCount = 26,
): PracticeCalendar {
  const todayKey = localDayKey(now.getTime());
  // Monday of this week: getDay() is 0 on Sunday.
  const sinceMonday = (now.getDay() + 6) % 7;
  const firstMonday = dayFrom(now, -sinceMonday - 7 * (weekCount - 1));

  const weeks: CalendarDay[][] = [];
  const inWindow = new Set<string>();
  let future = false;
  for (let w = 0; w < weekCount; w++) {
    const week: CalendarDay[] = [];
    for (let d = 0; d < 7; d++) {
      const key = localDayKey(dayFrom(firstMonday, w * 7 + d).getTime());
      const isToday = key === todayKey;
      week.push({ key, count: 0, level: 0, today: isToday, future });
      if (!future) inWindow.add(key);
      if (isToday) future = true;
    }
    weeks.push(week);
  }

  const counts = new Map<string, number>();
  for (const t of timestamps) {
    const key = localDayKey(t);
    if (inWindow.has(key)) counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  let solves = 0;
  for (const week of weeks) {
    for (const day of week) {
      day.count = counts.get(day.key) ?? 0;
      day.level = levelFor(day.count);
      solves += day.count;
    }
  }

  const months: PracticeCalendar["months"] = [];
  weeks.forEach((week, i) => {
    const first = week.find((d) => d.key.endsWith("-01"));
    if (first) months.push({ label: MONTHS[Number(first.key.slice(5, 7)) - 1], week: i });
  });

  return { weeks, months, days: counts.size, solves };
}
