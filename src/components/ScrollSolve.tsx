"use client";

import { useEffect, useRef, useState } from "react";

import { CubeView, type CubePlayer } from "@/components/CubeView";

/**
 * The cube solves itself as you scroll.
 *
 * This is the only kind of motion worth putting on a landing page for this product:
 * it is not an effect applied to the page, it is the actual product running. The
 * same `TwistyPlayer` that verifies your scramble in the app is doing the turning,
 * driven by scroll position instead of by a clock, and the phase labels alongside
 * are the real CFOP boundaries the analyser uses.
 *
 * Scroll progress maps to a move index rather than to a raw animation timeline, so
 * every turn lands on a real cube state — scrubbing backwards runs the solve
 * backwards, and stopping halfway leaves a legitimate position on screen rather
 * than a smear between two frames.
 */

/** A real CFOP solve: each step completes exactly one milestone. */
const STEPS = [
  { label: "Cross", alg: "D2 R' D'", note: "Four edges. The foundation, and the only part you plan in advance." },
  { label: "F2L 1", alg: "U R U' R'", note: "First corner-edge pair, slotted into the front right." },
  { label: "F2L 2", alg: "U' L' U L", note: "Second pair. Most of your time lives in these four." },
  { label: "F2L 3", alg: "U' R' U R", note: "Third pair — fewer free slots, less room to work." },
  { label: "F2L 4", alg: "U L U' L'", note: "Two layers done. Everything left is the last layer." },
  { label: "OLL", alg: "R U R' U R U2 R'", note: "Orient the top so the whole face is one colour." },
  { label: "PLL", alg: "R U R' U' R' F R2 U' R' U' R U R' F'", note: "Permute the last pieces. Solved." },
] as const;

const MOVES: { move: string; step: number }[] = STEPS.flatMap((step, i) =>
  step.alg.split(" ").map((move) => ({ move, step: i })),
);

function invert(alg: string): string {
  return alg
    .trim()
    .split(/\s+/)
    .reverse()
    .map((m) => (m.endsWith("2") ? m : m.endsWith("'") ? m.slice(0, -1) : `${m}'`))
    .join(" ");
}

const SCRAMBLE = invert(STEPS.map((s) => s.alg).join(" "));

export function ScrollSolve() {
  const sectionRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<CubePlayer | null>(null);
  const appliedRef = useRef(-1);
  const frameRef = useRef<number | null>(null);
  const [step, setStep] = useState(0);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return;

    const update = () => {
      frameRef.current = null;
      const rect = section.getBoundingClientRect();
      const scrollable = rect.height - window.innerHeight;
      if (scrollable <= 0) return;

      // 0 at the moment the section pins, 1 when it releases.
      const ratio = Math.min(Math.max(-rect.top / scrollable, 0), 1);
      setProgress(ratio);

      const count = Math.round(ratio * MOVES.length);
      if (count === appliedRef.current) return;
      appliedRef.current = count;

      // Rebuilding the setup from scratch each time keeps the cube honest in both
      // directions: scrubbing up runs the solve backwards, rather than stranding it
      // in a state no sequence of turns could reach.
      const applied = MOVES.slice(0, count).map((m) => m.move);
      playerRef.current?.setAttribute(
        "experimental-setup-alg",
        [SCRAMBLE, ...applied].join(" "),
      );
      setStep(count === 0 ? -1 : MOVES[Math.min(count, MOVES.length) - 1].step);
    };

    const onScroll = () => {
      frameRef.current ??= requestAnimationFrame(update);
    };

    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
  }, []);

  const current = step >= 0 ? STEPS[step] : null;

  return (
    <section ref={sectionRef} className="relative h-[560vh]">
      <div className="sticky top-0 flex h-dvh flex-col items-center justify-center gap-8 px-6">
        <p className="text-[10px] uppercase tracking-widest text-muted-dim">
          A solve, in seven steps
        </p>

        <CubeView
          scramble={SCRAMBLE}
          interactive={false}
          backView="none"
          onPlayerReady={(player) => {
            playerRef.current = player;
          }}
          className="h-[38vh] max-h-96 w-full max-w-md"
        />

        <div className="flex min-h-24 max-w-md flex-col items-center gap-3 text-center">
          <span
            className={`text-2xl font-medium tracking-tight transition-opacity duration-200 ${
              current ? "opacity-100" : "opacity-0"
            }`}
          >
            {current?.label ?? "Cross"}
          </span>
          <p className="text-sm leading-relaxed text-muted">
            {current?.note ?? "Scroll to solve it."}
          </p>
        </div>

        {/* The same phase strip the analyser produces, filling as the solve runs. */}
        <div className="flex w-full max-w-md gap-1" aria-hidden="true">
          {STEPS.map((s, i) => (
            <div key={s.label} className="h-1 flex-1 overflow-hidden rounded-sm bg-surface">
              <div
                className="h-full rounded-sm bg-ready transition-[width] duration-150 ease-out"
                style={{ width: step >= i ? "100%" : "0%" }}
              />
            </div>
          ))}
        </div>

        <p className="tnum text-xs text-muted-dim">
          {Math.min(Math.round(progress * MOVES.length), MOVES.length)} / {MOVES.length} moves
        </p>
      </div>
    </section>
  );
}
