import type { Metadata } from "next";
import Link from "next/link";

import { PageHero } from "@/components/PageHero";
import { SiteHeader } from "@/components/SiteHeader";
import { formatMs } from "@/lib/format";
import { ESTABLISHED_DEVIATION, WINDOW_SIZE, msForRating } from "@/lib/rating";
import { dailyBoard, ratingBoard, rushBoard } from "@/lib/server/boards";
import { followingBoard, type CircleEntry } from "@/lib/server/follows";
import { currentProfile } from "@/lib/server/profiles";
import { isDatabaseConfigured } from "@/lib/server/supabase";
import dailies from "@/data/dailies.json";
import { todayNumber } from "@/lib/daily";

export const metadata: Metadata = {
  title: "Leaderboard",
  description:
    "The global keyboard-cubing ladder, rated from verified solves only, and today's daily scramble.",
};

// The boards change whenever anyone finishes a window, and a stale ranking is a
// wrong ranking rather than a slightly old one.
export const dynamic = "force-dynamic";

export default async function LeaderboardPage() {
  if (!isDatabaseConfigured()) {
    return (
      <Shell>
        <p className="text-sm text-muted">
          Leaderboards need the database, which is not configured for this
          deployment.
        </p>
      </Shell>
    );
  }

  const day = todayNumber(dailies.start);

  // The boards throw rather than degrade to an empty list, so a failure has to be
  // caught and named here. Rendering "nobody is ranked yet" when the truth is
  // "the database is unreachable" would be a confident lie on the one page whose
  // entire value is being believed.
  let board: Awaited<ReturnType<typeof ratingBoard>> | null = null;
  let daily: Awaited<ReturnType<typeof dailyBoard>> | null = null;
  let rush: Awaited<ReturnType<typeof rushBoard>> | null = null;
  let circle: CircleEntry[] | null = null;
  let failed = false;

  try {
    const viewer = await currentProfile();
    [board, daily, rush, circle] = await Promise.all([
      ratingBoard("333", "keyboard"),
      dailyBoard(day),
      rushBoard(),
      viewer ? followingBoard(viewer.id) : Promise.resolve(null),
    ]);
  } catch {
    failed = true;
  }

  if (failed || board === null || daily === null || rush === null) {
    return (
      <Shell>
        <section className="w-full">
          <h2 className="mb-3 text-lg tracking-tight">
            The boards are not loading.
          </h2>
          <p className="max-w-xl text-sm leading-relaxed text-muted">
            Something is wrong at our end — this is not an empty leaderboard, it
            is a broken one, and saying otherwise would be worse than saying
            nothing. Solving, the daily and your own progress are unaffected.
          </p>
        </section>
      </Shell>
    );
  }

  return (
    <Shell>
      {circle && circle.length > 1 ? <FollowingSection circle={circle} /> : null}

      <section className="w-full">
        <header className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg tracking-tight">Global · 3x3 keyboard</h2>
          <p className="text-xs text-muted-dim">
            Established ratings only (±{ESTABLISHED_DEVIATION} or better)
          </p>
        </header>

        {board.length === 0 ? (
          <Empty>
            Nobody is ranked yet. It takes about {WINDOW_SIZE * 4} verified ranked
            solves to establish a rating.{" "}
            <Link href="/ranked" className="text-foreground underline underline-offset-4">
              Be first.
            </Link>
          </Empty>
        ) : (
          <ol className="divide-y divide-border overflow-hidden rounded-2xl border border-border">
            {board.map((entry) => (
              <li
                key={entry.handle}
                className="flex items-center gap-4 bg-surface px-4 py-3 transition-colors hover:bg-surface-hi"
              >
                <RankBadge rank={entry.rank} />
                <span
                  aria-hidden="true"
                  className="grid size-9 shrink-0 place-items-center rounded-lg bg-surface-hi font-display text-sm font-bold uppercase"
                >
                  {(entry.displayName || entry.handle).slice(0, 1)}
                </span>
                <Link
                  href={`/u/${entry.handle}`}
                  className="min-w-0 flex-1 truncate text-sm transition-colors hover:text-foreground"
                >
                  <span className="font-semibold">{entry.displayName}</span>
                  <span className="ml-2 text-muted-dim">@{entry.handle}</span>
                </Link>
                <span className="hidden text-xs text-muted-dim sm:inline">
                  {formatMs(msForRating(entry.rating), { truncate: false })} pace
                </span>
                <span className="tnum w-16 shrink-0 text-right font-display text-lg font-bold">
                  {Math.round(entry.rating)}
                </span>
                <span className="tnum hidden w-12 shrink-0 text-right text-xs text-muted-dim sm:inline">
                  ±{Math.round(entry.deviation)}
                </span>
              </li>
            ))}
          </ol>
        )}

        <p className="mt-3 max-w-2xl text-xs leading-relaxed text-muted-dim">
          Every solve here was replayed by the server against the scramble it was
          issued for. A rating appears only once it is precise enough to mean
          something — before that a player is unranked rather than badly ranked.
        </p>
        {circle && circle.length === 1 ? (
          <p className="mt-2 max-w-2xl text-xs leading-relaxed text-muted-dim" data-testid="follow-hint">
            Follow players from their profiles and they appear here beside you, provisional ratings included.
          </p>
        ) : null}
      </section>

      <section className="w-full">
        <header className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg tracking-tight">Rush</h2>
          <p className="text-xs text-muted-dim">Best run · every event</p>
        </header>

        {rush.length === 0 ? (
          <p className="max-w-xl text-sm leading-relaxed text-muted">
            No runs finished yet. Rush sets a target from your own pace and
            tightens it every time you beat it — the score is how many you held.
          </p>
        ) : (
          <ol className="divide-y divide-border overflow-hidden rounded-lg border border-border">
            {rush.map((entry) => (
              <li
                key={`${entry.handle}-${entry.at}`}
                className="flex items-center gap-4 bg-surface px-4 py-2.5 text-sm"
              >
                <span className="tnum w-6 shrink-0 text-right text-muted-dim">
                  {entry.rank}
                </span>
                <Link
                  href={`/u/${entry.handle}`}
                  className="min-w-0 flex-1 truncate transition-colors hover:text-foreground"
                >
                  {entry.displayName}
                  <span className="ml-2 font-mono text-xs text-muted-dim">
                    {entry.handle}
                  </span>
                </Link>
                <span className="shrink-0 text-xs text-muted-dim">{entry.event}</span>
                <span className="tnum shrink-0 text-xs text-muted-dim">
                  streak {entry.bestStreak}
                </span>
                <span className="tnum w-10 shrink-0 text-right font-medium">
                  {entry.score}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="w-full">
        <header className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg tracking-tight">Today&apos;s daily</h2>
          <p className="text-xs text-muted-dim">One attempt each · day {day}</p>
        </header>

        {daily.length === 0 ? (
          <Empty>
            No times on today&apos;s scramble yet.{" "}
            <Link href="/daily" className="text-foreground underline underline-offset-4">
              Take the first.
            </Link>
          </Empty>
        ) : (
          <ol className="divide-y divide-border overflow-hidden rounded-lg border border-border">
            {daily.map((entry) => (
              <li
                key={entry.handle}
                className="flex items-center gap-4 bg-surface px-4 py-3"
              >
                <span className="tnum w-8 shrink-0 text-sm text-muted-dim">
                  {entry.rank}
                </span>
                <Link
                  href={`/u/${entry.handle}`}
                  className="min-w-0 flex-1 truncate text-sm transition-colors hover:text-foreground"
                >
                  <span className="font-medium">{entry.displayName}</span>
                  <span className="ml-2 text-muted-dim">@{entry.handle}</span>
                </Link>
                {entry.verified ? null : (
                  <span
                    className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-dim"
                    title="Timed by hand, with no move stream to check against"
                  >
                    unverified
                  </span>
                )}
                <span className="tnum w-20 shrink-0 text-right text-sm font-medium">
                  {entry.penalty === "DNF"
                    ? "DNF"
                    : formatMs(
                        entry.durationMs + (entry.penalty === "PLUS2" ? 2000 : 0),
                      )}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </Shell>
  );
}

/**
 * You and the people you follow, on the same ratings as the global board.
 * Provisional ratings are shown here, marked, because among people you know a
 * settling number is still worth seeing; unrated players are listed last.
 */
function FollowingSection({ circle }: { circle: CircleEntry[] }) {
  let rank = 0;
  return (
    <section className="w-full" data-testid="following-board">
      <header className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg tracking-tight">You and who you follow</h2>
        <p className="text-xs text-muted-dim">3x3 keyboard · same ratings as the global board</p>
      </header>
      <ol className="divide-y divide-border overflow-hidden rounded-2xl border border-border">
        {circle.map((entry) => {
          if (entry.rating !== null) rank += 1;
          return (
            <li
              key={entry.handle}
              data-you={entry.isYou || undefined}
              className={`flex items-center gap-4 px-4 py-3 ${entry.isYou ? "bg-surface-hi" : "bg-surface"}`}
            >
              {entry.rating !== null ? (
                <RankBadge rank={rank} />
              ) : (
                <span className="w-8 shrink-0 text-center text-sm text-muted-dim">–</span>
              )}
              <Link
                href={`/u/${entry.handle}`}
                className="min-w-0 flex-1 truncate text-sm transition-colors hover:text-foreground"
              >
                <span className="font-semibold">{entry.displayName}</span>
                <span className="ml-2 text-muted-dim">{entry.isYou ? "you" : `@${entry.handle}`}</span>
              </Link>
              {entry.rating === null ? (
                <span className="text-xs text-muted-dim">unrated</span>
              ) : (
                <>
                  {entry.established ? null : (
                    <span
                      className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-dim"
                      title={`Not yet precise enough for the global board (±${ESTABLISHED_DEVIATION} or better)`}
                    >
                      provisional
                    </span>
                  )}
                  <span className="tnum w-16 shrink-0 text-right font-display text-lg font-bold">
                    {Math.round(entry.rating)}
                  </span>
                  <span className="tnum hidden w-12 shrink-0 text-right text-xs text-muted-dim sm:inline">
                    ±{Math.round(entry.deviation ?? 0)}
                  </span>
                </>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col">
      <SiteHeader active="leaderboard" />
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-12 px-4 pb-20 pt-6 sm:px-6 lg:pt-14">
        {/* A visible heading, not a hidden one: this page is a document rather
            than a solving surface, and it opened on an h2 with nothing above it. */}
        <PageHero eyebrow="Compete" title="Leaderboard">
          Every rating here comes from solves the server replayed against the
          scramble it issued. A daily time it could not check says so.
        </PageHero>
        {children}
      </div>
    </main>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-2xl border border-dashed border-border px-5 py-8 text-center text-sm text-muted">
      {children}
    </p>
  );
}

/**
 * The top three wear sticker colours — yellow, white, orange, the nearest the
 * cube has to gold, silver and bronze — and everyone else a plain number.
 */
function RankBadge({ rank }: { rank: number }) {
  const podium: Record<number, string> = {
    1: "var(--sticker-yellow)",
    2: "var(--sticker-white)",
    3: "var(--sticker-orange)",
  };
  const colour = podium[rank];
  if (!colour) {
    return <span className="tnum w-8 shrink-0 text-center text-sm text-muted-dim">{rank}</span>;
  }
  return (
    <span
      className="tnum grid size-8 shrink-0 place-items-center rounded-lg font-display text-sm font-extrabold text-background"
      style={{ background: colour }}
    >
      {rank}
    </span>
  );
}
