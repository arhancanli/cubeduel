"use client";

import { useEffect, useState } from "react";

import { AlgDemo } from "@/components/AlgDemo";
import { engineComparison } from "@/lib/engineCompare";

type State =
  | { kind: "loading" }
  | { kind: "failed" }
  | { kind: "ready"; moves: number; solution: string[] };

/**
 * How this site's own solver would solve the same scramble. It is the one
 * thing here no other timer can show — a from-scratch Kociemba solver — and
 * the review never showed it, only the count, and only right after a solve.
 *
 * Said as "a route", not "the optimal solution": the solver finds short routes,
 * about 19 moves, not proven-shortest ones.
 */
export function EngineSolution({ scramble, yourTurns }: { scramble: string; yourTurns: number | null }) {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    fetch("/api/solve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scramble }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { optimalMoves?: number; solution?: string[] } | null) => {
        if (cancelled) return;
        if (data && typeof data.optimalMoves === "number" && Array.isArray(data.solution)) {
          setState({ kind: "ready", moves: data.optimalMoves, solution: data.solution });
        } else {
          setState({ kind: "failed" });
        }
      })
      .catch(() => !cancelled && setState({ kind: "failed" }));
    return () => {
      cancelled = true;
    };
  }, [scramble]);

  return (
    <section className="flex flex-col gap-4" data-testid="engine-solution">
      <h2 className="text-xl">How the engine solves it</h2>
      {state.kind === "loading" ? (
        <div className="h-72 animate-pulse rounded-2xl bg-surface" aria-busy="true" />
      ) : state.kind === "failed" ? (
        <p className="text-sm text-muted-dim">The solver could not be reached just now. Reload to try again.</p>
      ) : (
        <>
          <p className="max-w-2xl text-sm leading-relaxed text-muted" data-testid="engine-summary">
            This site&rsquo;s solver finds a route in{" "}
            <span className="font-semibold text-foreground">{state.moves} moves</span>.{" "}
            {engineComparison(state.moves, yourTurns) ?? "A human method takes two to three times that — it is a different kind of solving."}
          </p>
          <div className="panel flex max-w-sm flex-col gap-3 rounded-xl p-4">
            <AlgDemo alg={state.solution.join(" ")} label="The engine's solution" from={scramble} />
            <p className="text-xs leading-relaxed text-muted-dim">
              Two-phase search: first into a subgroup of the cube, then home. It is not how a person
              solves — but it shows how short this scramble really was.
            </p>
          </div>
        </>
      )}
    </section>
  );
}
