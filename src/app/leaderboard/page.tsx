import type { Metadata } from "next";
import Link from "next/link";

import { SiteHeader } from "@/components/SiteHeader";
import { formatMs } from "@/lib/format";
import { ESTABLISHED_DEVIATION, WINDOW_SIZE, msForRating } from "@/lib/rating";
import { dailyBoard, ratingBoard } from "@/lib/server/boards";
import { isDatabaseConfigured } from "@/lib/server/supabase";
import dailies from "@/data/dailies.json";
import { todayNumber } from "@/lib/daily";

export const metadata: Metadata = {
  title: "Leaderboard",
  description:
    "The global keyboard-cubing ladder and today's daily scramble, from verified solves only.",
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
  let failed = false;

  try {
    [board, daily] = await Promise.all([
      ratingBoard("333", "keyboard"),
      dailyBoard(day),
    ]);
  } catch {
    failed = true;
  }

  if (failed || board === null || daily === null) {
    return (
      <Shell>
        <section className="w-full">
          <h2 className="mb-3 text-lg font-medium tracking-tight">
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
      <section className="w-full">
        <header className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-medium tracking-tight">Global · 3x3 keyboard</h2>
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
          <ol className="divide-y divide-border overflow-hidden rounded-lg border border-border">
            {board.map((entry) => (
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
                <span className="hidden text-xs text-muted-dim sm:inline">
                  {formatMs(msForRating(entry.rating), { truncate: false })} pace
                </span>
                <span className="tnum w-16 shrink-0 text-right text-sm font-medium">
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
      </section>

      <section className="w-full">
        <header className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-medium tracking-tight">Today&apos;s daily</h2>
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
                    className="text-[10px] uppercase tracking-widest text-muted-dim"
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

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col">
      <SiteHeader active="leaderboard" />
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-12 px-6 pb-20 pt-6">
        {children}
      </div>
    </main>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-lg border border-dashed border-border px-5 py-8 text-center text-sm text-muted">
      {children}
    </p>
  );
}
