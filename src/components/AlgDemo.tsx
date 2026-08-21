"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { CubeView } from "@/components/CubeView";
import { invertAlg } from "@/lib/learn";

/**
 * An algorithm, running on a cube, small enough to sit beside the words.
 *
 * The cube's state is rewritten as `setup + the moves so far`, so the cube, the
 * highlighted move and the counter are three views of one number and cannot
 * disagree. The setup is the algorithm's inverse, which means the demonstration
 * starts in the position the algorithm is *for* and ends solved — you watch the
 * thing being fixed, not an arbitrary scramble being stirred.
 */
export function AlgDemo({
  alg,
  label,
  hold = "",
}: {
  alg: string;
  label: string;
  /**
   * How the cube is held before anything is applied.
   *
   * cubing.js starts white on top. The beginner method is taught white on the
   * bottom, and a page that says "keep white underneath" beside a picture of a
   * white top face is teaching two different things at once — which is exactly
   * the sort of small contradiction that makes somebody give up and decide they
   * are following it wrong.
   *
   * `z2` turns the cube over while keeping the front face where it is, which is
   * what a person does when told to flip it. Moves after it are relative to how
   * the cube is now held, so R is still the side on your right.
   */
  hold?: string;
}) {
  const moves = useMemo(() => alg.split(/\s+/).filter(Boolean), [alg]);
  const setup = useMemo(() => {
    const inverse = invertAlg(alg);
    return hold ? `${hold} ${inverse}` : inverse;
  }, [alg, hold]);

  const [at, setAt] = useState(0);
  const [playing, setPlaying] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const atEnd = at >= moves.length;

  useEffect(() => {
    if (!playing || atEnd) return;
    timer.current = setTimeout(() => setAt((n) => n + 1), 620);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [playing, atEnd, at]);

  const state = useMemo(() => {
    const done = moves.slice(0, at);
    return done.length > 0 ? `${setup} ${done.join(" ")}` : setup;
  }, [setup, moves, at]);

  const toggle = useCallback(() => {
    if (atEnd) setAt(0);
    setPlaying((p) => !p);
  }, [atEnd]);

  return (
    <div className="flex flex-col gap-3">
      <div className="cube-stage relative mx-auto aspect-square w-full max-w-[15rem]">
        <CubeView
          scramble={state}
          interactive
          backView="none"
          cameraLatitude={45}
          className="h-full w-full"
        />
      </div>

      <div className="flex flex-wrap items-center gap-1">
        {moves.map((move, i) => (
          <button
            key={i}
            type="button"
            onClick={() => {
              setPlaying(false);
              setAt(i + 1);
            }}
            aria-label={`Go to move ${i + 1}, ${move}`}
            className={`rounded px-1.5 py-1 font-mono text-xs transition-colors ${
              i === at - 1
                ? "bg-foreground text-background"
                : i < at
                  ? "text-foreground hover:bg-surface"
                  : "text-muted-dim hover:bg-surface"
            }`}
          >
            {move}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={toggle}
          className="rounded-lg bg-foreground px-4 py-2 text-xs font-medium text-background transition-opacity hover:opacity-90"
        >
          {atEnd ? "Again" : playing ? "Pause" : "Watch it"}
        </button>
        <button
          type="button"
          onClick={() => {
            setPlaying(false);
            setAt((n) => Math.max(0, n - 1));
          }}
          aria-label={`${label}: back one move`}
          className="rounded-lg border border-border px-2.5 py-2 text-xs transition-colors hover:border-muted-dim"
        >
          ←
        </button>
        <button
          type="button"
          onClick={() => {
            setPlaying(false);
            setAt((n) => Math.min(moves.length, n + 1));
          }}
          aria-label={`${label}: forward one move`}
          className="rounded-lg border border-border px-2.5 py-2 text-xs transition-colors hover:border-muted-dim"
        >
          →
        </button>
        <span className="ml-auto font-mono text-xs text-muted-dim">
          {at} / {moves.length}
        </span>
      </div>
    </div>
  );
}
