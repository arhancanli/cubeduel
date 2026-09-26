"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { Glyph } from "@/components/Glyph";
import { dayNumber, msUntilNextUtcDay, utcDayKey } from "@/lib/daily";
import { faceFor, stickerVar, type FaceKey } from "@/lib/modes";
import { weekEnd, weekKey } from "@/lib/weekly";

/**
 * What is happening now, in three cards: the daily and how long is left on it,
 * the offers somebody has left open, and this week's competition and when it
 * closes. The third used to be "race a friend", which the hero above already
 * offers as a button, while the weekly went unmentioned on the home page.
 *
 * Every number here is live. The daily number and countdown are computed from
 * the clock, and the open-challenge count is the board's own endpoint — which
 * answers signed out, because the point is to show somebody arriving that there
 * is somebody to play.
 */
export function TodayStrip({ dailyStart }: { dailyStart: string }) {
  const [now, setNow] = useState<Date | null>(null);
  const [open, setOpen] = useState<number | null>(null);

  useEffect(() => {
    // The clock is read after mount, never during render: the server's "now"
    // and the browser's would disagree and the countdown would mismatch.
    const first = window.setTimeout(() => setNow(new Date()), 0);
    const tick = window.setInterval(() => setNow(new Date()), 30_000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(tick);
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/challenge/open", { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { open?: unknown[] } | null) => {
        if (body && Array.isArray(body.open)) setOpen(body.open.length);
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);

  const day = now ? dayNumber(dailyStart, utcDayKey(now)) : null;
  const left = now ? msUntilNextUtcDay(now) : null;
  const hours = left === null ? null : Math.floor(left / 3_600_000);
  const minutes = left === null ? null : Math.floor((left % 3_600_000) / 60_000);
  const week = now ? weekKey(now.getTime()) : null;
  const weekLeft = now && week ? weekEnd(week) - now.getTime() : null;

  return (
    <div className="grid gap-3 md:grid-cols-3">
      <TodayCard
        face="daily"
        eyebrow={day ? `Daily #${day}` : "Daily"}
        value={hours === null ? "…" : `${hours}h ${String(minutes).padStart(2, "0")}m left`}
        body="The same scramble for everyone. One attempt, final the moment the clock starts."
        href="/daily"
        action="Play today’s"
      />
      <TodayCard
        face="duel"
        eyebrow="Open challenges"
        value={open === null ? "…" : open === 0 ? "None open" : `${open} waiting`}
        body={
          open
            ? "Take one. The scramble stays hidden from both of you until your attempt starts."
            : "Leave one on the board and whoever turns up next takes it."
        }
        href="/duel"
        action={open ? "Take a challenge" : "Leave a challenge"}
      />
      <TodayCard
        face="ranked"
        glyph="101010101"
        eyebrow={week ? `Weekly · ${week}` : "Weekly"}
        value={weekLeft === null ? "…" : closesIn(weekLeft)}
        body="Five scrambles for everyone, one attempt at each, ranked by the average of five."
        href="/weekly"
        action="Enter this week’s"
      />
    </div>
  );
}

/** "3 days left", then "19h left" on the last day. */
function closesIn(ms: number): string {
  const days = Math.floor(ms / 86_400_000);
  if (days >= 1) return `${days} day${days === 1 ? "" : "s"} left`;
  return `${Math.max(0, Math.floor(ms / 3_600_000))}h left`;
}

function TodayCard({
  face,
  glyph,
  eyebrow,
  value,
  body,
  href,
  action,
}: {
  face: FaceKey;
  /** A pattern of its own, for a card played under another face's rules. */
  glyph?: string;
  eyebrow: string;
  value: string;
  body: string;
  href: string;
  action: string;
}) {
  const mode = faceFor(face);
  return (
    <Link
      href={href}
      style={{ "--face": stickerVar(mode.sticker) } as React.CSSProperties}
      className="group relative flex flex-col gap-2 overflow-hidden rounded-2xl border border-border bg-surface p-5 transition-colors hover:border-[var(--face)] sm:p-6"
    >
      <span className="flex items-center gap-2.5">
        <Glyph pattern={glyph ?? mode.glyph} sticker={mode.sticker} size={16} />
        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-dim">{eyebrow}</span>
      </span>
      <span className="tnum font-display text-3xl font-extrabold tracking-tight">{value}</span>
      <span className="text-sm leading-relaxed text-muted">{body}</span>
      <span className="mt-auto pt-2 text-sm font-semibold text-foreground">
        {action} <span aria-hidden="true" className="inline-block transition-transform group-hover:translate-x-0.5">→</span>
      </span>
    </Link>
  );
}
