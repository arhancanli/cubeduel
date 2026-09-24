"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { InsightsPanel, type InsightSolve } from "@/components/InsightsPanel";
import { PageHero } from "@/components/PageHero";
import { SiteHeader } from "@/components/SiteHeader";
import { SolveStudy } from "@/components/SolveStudy";
import { TimerSolveReview } from "@/components/TimerSolveReview";
import { eventLabel, eventOf, hasTimerReview } from "@/lib/timerEvents";
import type { TimedMove } from "@/lib/cfop";
import { formatMs } from "@/lib/format";
import { decodeMoveStream } from "@/lib/moveStream";
import { loadHistory, type StoredSolve } from "@/lib/solveHistory";

/**
 * Review a solve kept on this device.
 *
 * `?id=` names one; without it, the page lists the recent solves. A solve with
 * its turns — keyboard or smart cube — is read back one turn at a time. A
 * solve timed on a cube in somebody's hands has no turns, but it has a
 * scramble, whose best cross can be worked out, and maybe phase splits, which
 * can be set against their own usual. It used to be turned away as "nothing to
 * read back", which turned away most of the people who own a cube.
 */

interface Reviewable {
  solve: StoredSolve;
  /** Null for a solve timed on a real cube: there are no turns to read. */
  moves: TimedMove[] | null;
}

function reviewable(solve: StoredSolve): Reviewable | null {
  if (solve.penalty === "DNF" || !solve.scramble) return null;
  const moves = solve.moves ? decodeMoveStream(solve.moves) : null;
  if (moves && moves.length > 0) return { solve, moves };
  return solve.source === "manual" && hasTimerReview(eventOf(solve)) ? { solve, moves: null } : null;
}

export function ReviewScreen() {
  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "one"; item: Reviewable; history: StoredSolve[] }
    | { kind: "missing" }
    | { kind: "list"; items: Reviewable[]; total: number; insight: InsightSolve[] }
  >({ kind: "loading" });

  // Read reactively: moving from the list to a solve changes only the query,
  // and Next keeps this component mounted across that navigation.
  const id = useSearchParams().get("id");

  useEffect(() => {
    const read = () => {
      const history = loadHistory();
      if (id) {
        const solve = history.find((s) => s.id === id);
        const item = solve ? reviewable(solve) : null;
        setState(item ? { kind: "one", item, history } : { kind: "missing" });
        return;
      }
      const items = history
        .map(reviewable)
        .filter((r): r is Reviewable => r !== null)
        .reverse()
        .slice(0, 30);
      const insight = items.flatMap(({ solve, moves }) =>
        moves
          ? [{ href: `/review?id=${encodeURIComponent(solve.id)}`, scramble: solve.scramble, moves, durationMs: solve.durationMs }]
          : [],
      );
      setState({ kind: "list", items, total: history.length, insight });
    };
    // Read after mount: the history lives in this browser, not on the server.
    const timer = window.setTimeout(read, 0);
    return () => window.clearTimeout(timer);
  }, [id]);

  return (
    <main className="flex min-h-dvh flex-col">
      <SiteHeader active="review" />
      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-10 px-4 pb-24 pt-6 sm:px-8 lg:pt-12">
        {state.kind === "one" ? (
          <>
            <PageHero
              eyebrow={eventOf(state.item.solve) === "333" ? "Solve review" : `Solve review · ${eventLabel(eventOf(state.item.solve))}`}
              title={formatMs(state.item.solve.durationMs, { truncate: false })}
            >
              <p>
                {new Date(state.item.solve.at).toLocaleString(undefined, {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
                {" · "}
                <Link href="/review" className="underline decoration-border underline-offset-4 hover:decoration-current">
                  All reviewable solves
                </Link>
              </p>
              <p className="mt-2 font-mono text-sm tracking-wide text-muted-dim">{state.item.solve.scramble}</p>
            </PageHero>
            {state.item.moves ? (
              <SolveStudy
                scramble={state.item.solve.scramble}
                moves={state.item.moves}
                durationMs={state.item.solve.durationMs}
              />
            ) : (
              <TimerSolveReview solve={state.item.solve} history={state.history} />
            )}
          </>
        ) : (
          <>
            <PageHero eyebrow="Improve" title="Solve review">
              Solves on the keyboard or a smart cube are read back one turn at a time — where you
              stopped, the turns you undid. Solves timed on your own cube show the best cross the
              scramble offered and, with phase splits, which phase cost you.
            </PageHero>
            {state.kind === "missing" ? (
              <p className="rounded-2xl border border-border bg-surface px-5 py-5 text-sm text-muted">
                That solve is not on this device.
              </p>
            ) : null}
            {state.kind === "list" && state.insight.length > 0 ? (
              <InsightsPanel solves={state.insight} />
            ) : null}
            {state.kind === "list" ? (
              <section className="flex flex-col gap-3">
                {state.items.length > 0 ? <h2 className="text-xl">Every solve you can review</h2> : null}
                <SolveList items={state.items} total={state.total} />
              </section>
            ) : null}
          </>
        )}
      </div>
    </main>
  );
}

function SolveList({ items, total }: { items: Reviewable[]; total: number }) {
  if (items.length === 0) {
    return (
      <div className="flex flex-col items-start gap-4 rounded-2xl border border-dashed border-border px-6 py-8">
        <p className="max-w-lg text-sm leading-relaxed text-muted">
          {total === 0 ? "No solves on this device yet." : "None of the solves on this device can be reviewed."}{" "}
          Time a solve on your own cube, or solve on the keyboard, and it will be here.
        </p>
        <Link href="/timer" className="btn-go px-5 py-2.5 text-sm">
          Open the timer
        </Link>
      </div>
    );
  }
  return (
    <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
      {items.map(({ solve, moves }) => (
        <li key={solve.id}>
          <Link
            href={`/review?id=${encodeURIComponent(solve.id)}`}
            className="flex items-center gap-4 px-5 py-3.5 transition-colors hover:bg-surface-hi"
          >
            <span className="tnum w-20 shrink-0 font-display text-lg font-bold">
              {formatMs(solve.durationMs, { truncate: false })}
            </span>
            <span className="min-w-0 flex-1 truncate text-sm text-muted">
              {new Date(solve.at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
              <span className="text-muted-dim">
                {eventOf(solve) !== "333" ? ` · ${eventLabel(eventOf(solve))}` : ""}
                {" · "}
                {moves
                  ? `${moves.length} moves recorded`
                  : solve.splits.length > 0
                    ? "timed, phases split"
                    : "timed"}
              </span>
            </span>
            <span className="shrink-0 text-sm font-semibold">Review →</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
