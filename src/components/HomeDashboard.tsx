"use client";

import { eventLabel, eventOf, hasTimerReview } from "@/lib/timerEvents";
import Link from "next/link";
import { useEffect, useState } from "react";

import { CubeNet } from "@/components/CubeNet";
import { Glyph } from "@/components/Glyph";
import { StreakCard } from "@/components/StreakCard";
import { TodayStrip } from "@/components/TodayStrip";
import { utcDayKey } from "@/lib/daily";
import { getEntry, type DailyEntry } from "@/lib/dailyStorage";
import { formatMs } from "@/lib/format";
import { faceFor, stickerVar } from "@/lib/modes";
import { decodeMoveStream } from "@/lib/moveStream";
import { loadHistory, type StoredSolve } from "@/lib/solveHistory";

interface Home {
  signedIn: true;
  handle: string;
  ranked: {
    rating: number | null;
    deviation: number;
    established: boolean;
    peak: number | null;
    averageMs: number | null;
    pending: number;
    windowSize: number;
  } | null;
  duels: { wins: number; losses: number } | null;
  challengesAwaiting: number | null;
  rushBest: number | null;
}

/**
 * The front page for somebody who already plays here.
 *
 * The pitch is for strangers. A player wants what chess.com gives on its home
 * page: where they stand, what is waiting for them, and one click to play. The
 * rating leads because it is the one number the site exists to produce; the
 * cube net stays because it is still the fastest way into any mode.
 */
export function HomeDashboard({ handle, dailyStart }: { handle: string | null; dailyStart: string }) {
  const [home, setHome] = useState<Home | null>(null);
  const [recent, setRecent] = useState<StoredSolve[]>([]);
  const [daily, setDaily] = useState<DailyEntry | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/home", { signal: controller.signal, cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((body: Home | { signedIn: false } | null) => {
        if (body && body.signedIn) setHome(body);
      })
      .catch(() => {});
    const timer = window.setTimeout(() => {
      setRecent(loadHistory().slice(-5).reverse());
      setDaily(getEntry(utcDayKey()));
    }, 0);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, []);

  const name = home?.handle ?? handle;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-4 pb-24 pt-6 sm:px-8 lg:pt-12">
      <header className="flex flex-col gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-sticker-green">Welcome back</p>
        <h1 className="text-balance text-4xl leading-[1.05] sm:text-5xl">{name ? `@${name}` : "Your home"}</h1>
      </header>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <RatingCard ranked={home?.ranked ?? null} loading={!home} />
        <div className="grid grid-cols-2 gap-3">
          <MiniCard
            face="duel"
            label="Challenges"
            value={home?.challengesAwaiting == null ? "—" : String(home.challengesAwaiting)}
            note={home?.challengesAwaiting ? "waiting on you" : "none waiting"}
            href="/duel"
          />
          <MiniCard
            face="daily"
            label="Today’s daily"
            value={daily?.status === "done" ? formatMs(daily.ms, { truncate: false }) : daily?.status === "started" ? "DNF" : "Not yet"}
            note={daily?.status === "done" ? "done today" : daily?.status === "started" ? "left mid-solve" : "one attempt"}
            href="/daily"
          />
          <MiniCard
            face="duel"
            label="Duel record"
            value={home?.duels ? `${home.duels.wins}–${home.duels.losses}` : "—"}
            note="wins – losses"
            href="/duel"
          />
          <MiniCard
            face="rush"
            label="Rush best"
            value={home?.rushBest == null ? "—" : String(home.rushBest)}
            note={home?.rushBest == null ? "no run yet" : "targets beaten"}
            href="/rush"
          />
        </div>
      </div>

      <StreakCard />

      <section className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,30rem)]">
        <div className="flex flex-col gap-3">
          <h2 className="text-xl">Recent solves</h2>
          {recent.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-border px-5 py-6 text-sm text-muted">
              Nothing on this device yet.{" "}
              <Link href="/play" className="font-semibold text-foreground underline underline-offset-4">
                Solve one
              </Link>
              .
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
              {recent.map((solve) => {
                // Turns to read back, or a solve timed on a real cube — which has
                // its own review: the best cross, and its phases.
                const reviewable =
                  solve.penalty !== "DNF" &&
                  (solve.moves
                    ? (decodeMoveStream(solve.moves)?.length ?? 0) > 0
                    : solve.source === "manual" && hasTimerReview(eventOf(solve)));
                return (
                  <li key={solve.id} className="flex items-center gap-4 px-5 py-3">
                    <span className="tnum w-20 shrink-0 font-display text-lg font-bold">
                      {solve.penalty === "DNF" ? "DNF" : formatMs(solve.durationMs, { truncate: false })}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm text-muted-dim">
                      {eventOf(solve) !== "333" ? `${eventLabel(eventOf(solve))} · ` : ""}
                      {new Date(solve.at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                    </span>
                    {reviewable ? (
                      <Link
                        href={`/review?id=${encodeURIComponent(solve.id)}`}
                        className="shrink-0 text-sm font-semibold hover:underline"
                      >
                        Review →
                      </Link>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
          <div className="flex gap-5 text-sm">
            <Link href="/progress" className="font-semibold text-muted hover:text-foreground">
              Progress →
            </Link>
            <Link href="/review" className="font-semibold text-muted hover:text-foreground">
              Insights →
            </Link>
          </div>
        </div>
        <div className="flex flex-col gap-3">
          <h2 className="text-xl">Play</h2>
          <CubeNet />
        </div>
      </section>

      <TodayStrip dailyStart={dailyStart} />
    </div>
  );
}

function RatingCard({ ranked, loading }: { ranked: Home["ranked"]; loading: boolean }) {
  const face = faceFor("ranked");
  const rated = ranked?.rating != null;
  const toGo = ranked ? Math.max(0, ranked.windowSize - ranked.pending) : null;
  return (
    <Link
      href="/ranked"
      style={{ "--face": stickerVar(face.sticker) } as React.CSSProperties}
      className="group relative flex flex-col gap-3 overflow-hidden rounded-3xl border border-border bg-surface p-6 transition-colors hover:border-[var(--face)] sm:p-7"
      data-testid="home-rating"
    >
      <span aria-hidden="true" className="absolute inset-x-0 top-0 h-1.5" style={{ background: stickerVar(face.sticker) }} />
      <span className="flex items-center gap-2.5">
        <Glyph pattern={face.glyph} sticker={face.sticker} size={18} />
        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-dim">Ranked · 3×3 keyboard</span>
      </span>
      {loading ? (
        <span className="h-16 w-40 animate-pulse rounded-xl bg-surface-hi" />
      ) : rated && ranked ? (
        <>
          <span className="flex items-baseline gap-3">
            <span className="tnum font-display text-6xl font-extrabold tracking-tight">{ranked.rating}</span>
            <span className="tnum text-lg text-muted">±{ranked.deviation}</span>
          </span>
          <span className="text-sm text-muted">
            {ranked.averageMs != null ? `Reads as a ${formatMs(ranked.averageMs, { truncate: false })} average` : null}
            {ranked.peak != null ? ` · peak ${ranked.peak}` : null}
            {!ranked.established ? " · still settling" : null}
          </span>
        </>
      ) : (
        <>
          <span className="font-display text-4xl font-extrabold tracking-tight">Unrated</span>
          <span className="text-sm text-muted">
            {toGo === null || toGo === (ranked?.windowSize ?? 5)
              ? "Five verified solves and you have a rating."
              : `${toGo} more verified solve${toGo === 1 ? "" : "s"} to your first rating.`}
          </span>
        </>
      )}
      <span className="btn-go mt-2 self-start px-5 py-2.5 text-sm">
        {ranked?.pending ? "Continue ranked" : "Play ranked"}
      </span>
    </Link>
  );
}

function MiniCard({
  face,
  label,
  value,
  note,
  href,
}: {
  face: "duel" | "daily" | "rush";
  label: string;
  value: string;
  note: string;
  href: string;
}) {
  const mode = faceFor(face);
  return (
    <Link
      href={href}
      style={{ "--face": stickerVar(mode.sticker) } as React.CSSProperties}
      className="flex flex-col gap-1.5 rounded-2xl border border-border bg-surface p-4 transition-colors hover:border-[var(--face)] sm:p-5"
    >
      <span className="flex items-center gap-2">
        <Glyph pattern={mode.glyph} sticker={mode.sticker} size={14} />
        <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-dim">{label}</span>
      </span>
      <span className="tnum font-display text-2xl font-bold sm:text-3xl">{value}</span>
      <span className="text-xs text-muted-dim">{note}</span>
    </Link>
  );
}
