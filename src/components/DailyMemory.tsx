"use client";

import { speedTier, TIER_MAX } from "@/lib/daily";
import { computeDailyStats, wasAttempted, type DailyStats } from "@/lib/dailyStats";
import { formatMs } from "@/lib/format";
import { loadDailyStore } from "@/lib/dailyStorage";

/**
 * What the daily has accumulated.
 *
 * An attempt used to end in a time and nothing else — nothing moved, nothing was at
 * stake tomorrow. This is the smallest thing that changes that, and every number in
 * it was already on disk and simply never read back.
 *
 * The streak is stated, never demanded. There is no "don't lose your streak!", no
 * countdown, no warning — it records what you did rather than threatening you with
 * what you might not do. A record is a reason to come back; a hostage is a reason to
 * resent the app.
 */
export function readDailyStats(todayKey: string): DailyStats {
  return computeDailyStats(loadDailyStore().entries, todayKey);
}

export function DailyMemory({
  stats,
  todayKey,
  className = "",
}: {
  stats: DailyStats;
  todayKey: string;
  className?: string;
}) {
  if (stats.played === 0) return null;

  return (
    <div className={`flex flex-col items-center gap-4 ${className}`}>
      <div className="flex items-center gap-8">
        <Figure label="streak" value={`${stats.currentStreak}`} />
        <Figure
          label="best daily"
          value={stats.bestMs === null ? "—" : formatMs(stats.bestMs)}
        />
        <Figure label="played" value={`${stats.played}`} />
      </div>

      {/* Fourteen days. Height carries the result, absence carries a miss. */}
      <div className="flex items-end gap-1" aria-hidden="true">
        {stats.recent.map((day) => {
          const attempted = wasAttempted(day);
          const tier = day.ms === null ? 0 : speedTier(day.ms);
          const isToday = day.dayKey === todayKey;
          return (
            <span
              key={day.dayKey}
              title={`${day.dayKey}: ${day.ms === null ? (day.dnf ? "DNF" : "not played") : formatMs(day.ms)}`}
              className={`w-2 rounded-sm ${
                !attempted
                  ? "h-1 bg-surface"
                  : day.dnf
                    ? "h-1.5 bg-danger/60"
                    : isToday
                      ? "bg-ready"
                      : "bg-bar"
              }`}
              style={
                attempted && !day.dnf
                  ? { height: `${6 + (tier / TIER_MAX) * 18}px` }
                  : undefined
              }
            />
          );
        })}
      </div>

      {stats.previous ? (
        <p className="text-xs text-muted-dim">
          Yesterday you were{" "}
          {stats.previous.ms === null ? "a DNF" : formatMs(stats.previous.ms)}.
        </p>
      ) : null}
    </div>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-dim">{label}</span>
      <span className="tnum text-lg font-medium text-muted">{value}</span>
    </div>
  );
}
