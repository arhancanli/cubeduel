import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { RatingHistory } from "@/components/RatingHistory";
import { SiteHeader } from "@/components/SiteHeader";
import { formatMs } from "@/lib/format";
import { ESTABLISHED_DEVIATION, WINDOW_SIZE, msForRating } from "@/lib/rating";
import { profileStats } from "@/lib/server/boards";
import { profileByHandle } from "@/lib/server/profiles";
import { isDatabaseConfigured } from "@/lib/server/supabase";

export const dynamic = "force-dynamic";

export async function generateMetadata(
  props: PageProps<"/u/[handle]">,
): Promise<Metadata> {
  const { handle } = await props.params;
  if (!isDatabaseConfigured()) return { title: "cubeduel" };

  const profile = await profileByHandle(handle);
  if (!profile) return { title: "Player not found" };

  return {
    title: `${profile.display_name} (@${profile.handle})`,
    description: `Speedcubing rating, personal bests and verified solves for @${profile.handle}.`,
  };
}

/**
 * A player's public page.
 *
 * The design rule here is the same one that governs the analysis screens: keep
 * measurement and interpretation visibly apart, and never print a number that
 * cannot be justified. A rating carries its ± wherever it appears, an
 * unestablished rating says so rather than being quietly ranked, and "no data" is
 * written as no data instead of a zero.
 */
export default async function ProfilePage(props: PageProps<"/u/[handle]">) {
  const { handle } = await props.params;

  if (!isDatabaseConfigured()) notFound();

  const profile = await profileByHandle(handle);
  if (!profile) notFound();

  const stats = await profileStats(profile.id);

  return (
    <main className="flex min-h-dvh flex-col">
      <SiteHeader active="leaderboard" />

      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-10 px-6 pb-20 pt-6">
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl tracking-tight">
            {profile.display_name}
          </h1>
          <p className="text-sm text-muted-dim">
            @{profile.handle}
            {profile.country ? ` · ${profile.country}` : ""}
            {" · joined "}
            {new Date(profile.created_at).toLocaleDateString("en-GB", {
              month: "short",
              year: "numeric",
            })}
          </p>
          {profile.bio ? (
            <p className="mt-2 max-w-prose text-sm text-muted">{profile.bio}</p>
          ) : null}
        </header>

        <section className="flex flex-wrap gap-x-10 gap-y-6">
          <Stat
            label="rating"
            value={stats.rating === null ? "—" : String(Math.round(stats.rating))}
            note={
              stats.rating === null
                ? "unrated"
                : `${formatMs(msForRating(stats.rating), { truncate: false })} pace · ±${Math.round(stats.deviation)}`
            }
          />
          <Stat
            label="rank"
            value={stats.rank === null ? "—" : `#${stats.rank}`}
            note={
              stats.established
                ? "3x3 keyboard"
                : `unranked until ±${ESTABLISHED_DEVIATION}`
            }
          />
          <Stat
            label="best single"
            value={stats.bestSingleMs === null ? "—" : formatMs(stats.bestSingleMs)}
            note="verified solves only"
          />
          <Stat
            label="peak"
            value={stats.peak === null ? "—" : String(Math.round(stats.peak))}
            note={stats.peak === null ? "none set yet" : "highest established"}
          />
          <Stat
            label="ranked solves"
            value={String(stats.rankedSolves)}
            note={`${WINDOW_SIZE} per rating update`}
          />
          {/*
            Shown beside the rating but never folded into it. A duel result says
            who was faster on one cube; the rating says how fast this player is.
            Presenting them as one number would imply the ladder counts races,
            which it deliberately does not.
          */}
          <Stat
            label="duels"
            value={
              stats.duelWins + stats.duelLosses === 0
                ? "—"
                : `${stats.duelWins}W ${stats.duelLosses}L`
            }
            note="does not affect rating"
          />
        </section>

        {stats.rating !== null && !stats.established ? (
          <p className="rounded-lg border border-border bg-surface px-4 py-3 text-xs leading-relaxed text-muted">
            This rating is still provisional. It is shown because it is the best
            estimate available, but it is not precise enough to rank — that takes
            roughly {WINDOW_SIZE * 4} ranked solves.
          </p>
        ) : null}

        {stats.history.length > 1 ? (
          <section>
            <h2 className="mb-3 text-[10px] uppercase tracking-widest text-muted-dim">
              Rating over time
            </h2>
            <RatingHistory points={stats.history} />
          </section>
        ) : null}

        <section>
          <h2 className="mb-3 text-[10px] uppercase tracking-widest text-muted-dim">
            Recent solves
          </h2>
          {stats.recent.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-border px-5 py-8 text-center text-sm text-muted">
              No solves recorded yet.
            </p>
          ) : (
            <ol className="divide-y divide-border overflow-hidden rounded-lg border border-border">
              {stats.recent.map((solve, i) => (
                <li key={`${solve.solvedAt}-${i}`} className="bg-surface">
                  {/* The whole row is the link. Every solve has a page — the
                      move stream is the one thing this site has that a
                      stopwatch does not, and it is worth one click. */}
                  <Link
                    href={`/s/${solve.id}`}
                    className="flex items-center gap-4 px-4 py-2.5 text-sm transition-colors hover:bg-border/40"
                  >
                  <span className="tnum w-20 shrink-0 font-medium">
                    {solve.penalty === "DNF"
                      ? "DNF"
                      : formatMs(
                          solve.durationMs + (solve.penalty === "PLUS2" ? 2000 : 0),
                        )}
                  </span>
                  <span className="w-16 shrink-0 text-xs text-muted-dim">
                    {solve.mode}
                  </span>
                  <span className="tnum hidden w-16 shrink-0 text-xs text-muted-dim sm:inline">
                    {solve.moveCount} mv
                  </span>
                  <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-dim">
                    {solve.scramble}
                  </span>
                  </Link>
                </li>
              ))}
            </ol>
          )}
        </section>

        <Link
          href="/leaderboard"
          className="text-xs text-muted-dim transition-colors hover:text-foreground"
        >
          ← Leaderboard
        </Link>
      </div>
    </main>
  );
}

function Stat({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-widest text-muted-dim">
        {label}
      </span>
      <span className="tnum text-2xl font-medium">{value}</span>
      <span className="text-[11px] text-muted-dim">{note}</span>
    </div>
  );
}
