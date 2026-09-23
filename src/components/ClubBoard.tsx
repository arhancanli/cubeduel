import Link from "next/link";

import { formatMs } from "@/lib/format";
import { msForRating } from "@/lib/rating";
import { ratedCount, type ClubMemberStanding } from "@/lib/club";
import { EVENTS, type EventId } from "@/lib/events";

/**
 * A club's board.
 *
 * The one design decision that matters: **unrated members are listed**, without
 * a position and without a number. A board that showed only the rated would
 * greet a beginner on the day they join with a list they are not on, which is
 * precisely the person a club exists to keep.
 *
 * So the rated are ranked and the rest are present, and the boundary between
 * them is stated rather than implied — with what it takes to cross it, because
 * that is the useful thing to know when you are below it.
 */
export function ClubBoard({
  standings,
  event,
}: {
  standings: ClubMemberStanding[];
  event: EventId;
}) {
  const rated = standings.filter((s) => s.rating !== null);
  const unrated = standings.filter((s) => s.rating === null);

  return (
    <section className="flex flex-col gap-5">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg tracking-tight">Members</h2>
        <p className="text-xs text-muted-dim">
          {/* The event's name, not its id. `333` is what the database calls it
              and nobody else does. */}
          {ratedCount(standings)} of {standings.length} rated · {EVENTS[event].longName}
        </p>
      </header>

      {rated.length > 0 ? (
        <ol className="flex list-none flex-col gap-px overflow-hidden rounded-xl border border-border bg-border p-0">
          {rated.map((member, index) => (
            <li
              key={member.handle}
              className="flex items-center gap-4 bg-surface px-4 py-3"
            >
              <span className="w-6 shrink-0 text-right font-mono text-sm tabular-nums text-muted-dim">
                {index + 1}
              </span>

              <Link
                href={`/u/${member.handle}`}
                className="min-w-0 flex-1 truncate text-sm underline decoration-transparent underline-offset-4 transition-colors hover:decoration-current"
              >
                {member.displayName}
                {member.role === "owner" ? (
                  <span className="ml-2 text-xs text-muted-dim">owner</span>
                ) : null}
              </Link>

              <span className="flex shrink-0 flex-col items-end">
                <span className="font-mono text-sm font-medium tabular-nums">
                  {member.rating}
                </span>
                {/* The rating converts back to the average that earned it, so
                    the number is never just a number. */}
                <span className="font-mono text-xs tabular-nums text-muted-dim">
                  {formatMs(msForRating(member.rating as number))}
                </span>
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="rounded-xl border border-dashed border-border px-5 py-8 text-center text-sm text-muted">
          Nobody here has an established rating yet. It takes about 20 verified
          ranked solves — whoever gets there first is top of this board.
        </p>
      )}

      {unrated.length > 0 ? (
        <div className="flex flex-col gap-3">
          <h3 className="text-[10px] uppercase tracking-widest text-muted-dim">
            Not rated yet
          </h3>
          <ul className="flex list-none flex-col gap-px overflow-hidden rounded-xl border border-border bg-border p-0">
            {unrated.map((member) => (
              <li
                key={member.handle}
                className="flex items-center gap-4 bg-surface px-4 py-3"
              >
                {/* No position number. A rank implies a comparison the ladder
                    has deliberately refused to make. */}
                <span className="w-6 shrink-0" aria-hidden />
                <Link
                  href={`/u/${member.handle}`}
                  className="min-w-0 flex-1 truncate text-sm text-muted underline decoration-transparent underline-offset-4 transition-colors hover:decoration-current"
                >
                  {member.displayName}
                  {member.role === "owner" ? (
                    <span className="ml-2 text-xs text-muted-dim">owner</span>
                  ) : null}
                </Link>
                <span className="shrink-0 font-mono text-xs tabular-nums text-muted-dim">
                  {member.solveCount > 0 ? `${member.solveCount} solves` : "no solves yet"}
                </span>
              </li>
            ))}
          </ul>
          <p className="max-w-lg text-xs leading-relaxed text-muted-dim">
            A rating appears once it is precise enough to mean something — before
            that somebody is unrated rather than badly rated. Everyone here is on
            the same ladder as the global board; there is no club-only scoring.
          </p>
        </div>
      ) : null}
    </section>
  );
}
