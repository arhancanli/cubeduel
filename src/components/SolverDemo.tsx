"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import demos from "@/data/demo-solves.json";

/**
 * The engine, solving a cube, on the landing page.
 *
 * This is the one claim on the page that a visitor can check for themselves, so
 * it is built to be checkable. The scrambles are WCA random-state scrambles, the
 * solutions come from this repository's own two-phase solver, and the move
 * counts and timings printed underneath are the ones measured when they were
 * generated — not illustrative numbers.
 *
 * Precomputed rather than solved on demand, because the demo has to be instant.
 * Solving live costs 1.1-1.9s including the round trip, which is acceptable for
 * something a player asked for and far too slow for the first thing anybody
 * sees. The "solve mine" box below hits the live API, so the live path is still
 * one click away for anyone who suspects the rest is a recording.
 */

interface Demo {
  scramble: string;
  solution: string[];
  moves: number;
  ms: number;
}

const DEMOS = demos as Demo[];

interface PlayerLike extends HTMLElement {
  alg: string;
  play(): void;
  pause(): void;
  jumpToStart(): void;
  timestamp: number;
  tempoScale: number;
}

export function SolverDemo() {
  const hostRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<PlayerLike | null>(null);
  const [index, setIndex] = useState(0);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  const demo = DEMOS[index];

  // Built once. Swapping the scramble and solution is a property write, not a
  // teardown — rebuilding the Three.js scene per solve would stutter visibly.
  useEffect(() => {
    let cancelled = false;
    const host = hostRef.current;
    if (!host) return;

    (async () => {
      try {
        const { TwistyPlayer } = await import("cubing/twisty");
        if (cancelled) return;

        const player = new TwistyPlayer({
          puzzle: "3x3x3",
          visualization: "3D",
          background: "none",
          controlPanel: "none",
          backView: "none",
          hintFacelets: "none",
          experimentalDragInput: "auto",
          // Slower than a real solve on purpose. The engine's answer arrives in
          // milliseconds; watching twenty moves land in milliseconds shows a
          // blur. The number underneath is the honest one.
          tempoScale: 2.2,
        }) as unknown as PlayerLike;

        player.style.width = "100%";
        player.style.height = "100%";
        host.replaceChildren(player);
        playerRef.current = player;
        setReady(true);
      } catch {
        // A demo that fails to load must not take the page with it.
        setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
      playerRef.current = null;
    };
  }, []);

  // Drive the current demo: set the scramble as the starting position, the
  // solution as the algorithm, and play it.
  useEffect(() => {
    const player = playerRef.current;
    if (!player || !ready) return;

    player.setAttribute("experimental-setup-alg", demo.scramble);
    player.alg = demo.solution.join(" ");
    player.jumpToStart();

    // A beat before it moves, so the scrambled state registers as the starting
    // point rather than as a flicker.
    const timer = setTimeout(() => player.play(), 700);
    return () => clearTimeout(timer);
  }, [demo, ready]);

  const next = useCallback(() => {
    setIndex((i) => (i + 1) % DEMOS.length);
  }, []);

  if (failed) return null;

  return (
    <div className="flex w-full flex-col items-center gap-4">
      <div ref={hostRef} className="h-[34vh] max-h-80 min-h-52 w-full max-w-md" />

      <div className="flex flex-col items-center gap-1.5">
        <div className="tnum flex items-baseline gap-4 text-sm">
          <span>
            <span className="text-2xl font-medium">{demo.moves}</span>
            <span className="ml-1.5 text-muted-dim">moves</span>
          </span>
          <span className="text-border">·</span>
          <span>
            <span className="text-2xl font-medium">{demo.ms}</span>
            <span className="ml-1 text-muted-dim">ms to find</span>
          </span>
        </div>
        <p className="max-w-sm text-center text-xs leading-relaxed text-muted-dim">
          God&apos;s number is 20, so a solution within a move or two of that is
          about as short as a cube can be solved. This engine is in this
          repository — no solver library.
        </p>
      </div>

      <div className="flex w-full max-w-md flex-col items-center gap-2">
        <div className="flex max-w-full flex-wrap justify-center gap-x-2 gap-y-1 font-mono text-[11px] leading-relaxed text-muted-dim">
          {demo.scramble.split(" ").map((move, i) => (
            <span key={`${move}-${i}`}>{move}</span>
          ))}
        </div>
        <button
          type="button"
          onClick={next}
          className="rounded-lg border border-border px-4 py-1.5 text-xs text-muted transition-colors hover:border-muted-dim hover:text-foreground"
        >
          Solve another
        </button>
      </div>
    </div>
  );
}
