"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { PageHero } from "@/components/PageHero";
import { SiteHeader } from "@/components/SiteHeader";
import { SolveStudy } from "@/components/SolveStudy";
import type { TimedMove } from "@/lib/cfop";
import { formatMs } from "@/lib/format";
import { decodeMoveStream } from "@/lib/moveStream";
import { loadHistory, type StoredSolve } from "@/lib/solveHistory";

/**
 * Review a solve kept on this device.
 *
 * `?id=` names one; without it, the page lists the recent solves that can be
 * reviewed. Only solves with their turns can be — a stopwatch time has nothing
 * to read back — and the list says so rather than showing rows that lead
 * nowhere.
 */

interface Reviewable {
  solve: StoredSolve;
  moves: TimedMove[];
}

function reviewable(solve: StoredSolve): Reviewable | null {
  if (!solve.moves || solve.penalty === "DNF") return null;
  const moves = decodeMoveStream(solve.moves);
  return moves && moves.length > 0 ? { solve, moves } : null;
}

export function ReviewScreen() {
  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "one"; item: Reviewable }
    | { kind: "missing" }
    | { kind: "list"; items: Reviewable[]; total: number }
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
        setState(item ? { kind: "one", item } : { kind: "missing" });
        return;
      }
      const items = history
        .map(reviewable)
        .filter((r): r is Reviewable => r !== null)
        .reverse()
        .slice(0, 30);
      setState({ kind: "list", items, total: history.length });
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
            <PageHero eyebrow="Solve review" title={formatMs(state.item.solve.durationMs, { truncate: false })}>
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
            <SolveStudy
              scramble={state.item.solve.scramble}
              moves={state.item.moves}
              durationMs={state.item.solve.durationMs}
            />
          </>
        ) : (
          <>
            <PageHero eyebrow="Improve" title="Solve review">
              Pick a solve and it is read back one turn at a time: the shortest cross you could have
              built, where you stopped, the turns you undid, and the cases worth learning next.
            </PageHero>
            {state.kind === "missing" ? (
              <p className="rounded-2xl border border-border bg-surface px-5 py-5 text-sm text-muted">
                That solve is not on this device, or it was timed with a stopwatch and has no turns to
                read back.
              </p>
            ) : null}
            {state.kind === "list" ? <SolveList items={state.items} total={state.total} /> : null}
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
          {total === 0
            ? "No solves on this device yet."
            : "None of the solves on this device kept their turns — stopwatch times have only a time."}{" "}
          Solve on the keyboard, or with a connected smart cube, and every solve can be reviewed.
        </p>
        <Link href="/play" className="btn-go px-5 py-2.5 text-sm">
          Solve on the keyboard
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
              <span className="text-muted-dim"> · {moves.length} moves recorded</span>
            </span>
            <span className="shrink-0 text-sm font-semibold">Review →</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
