"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { CubeView } from "@/components/CubeView";
import type { PhaseSplit, TimedMove } from "@/lib/cfop";
import { formatMs } from "@/lib/format";
import { movesPlayedBy, phaseAt, replayLengthMs } from "@/lib/replay";

/**
 * A solve, played back at the speed it happened.
 *
 * The move stream is stored with a timestamp on every move, so this is a
 * recording rather than an animation. That distinction is the entire value: the
 * pauses are the information. A replay at some invented constant tempo would
 * show you the moves and hide the thing you actually want to see — the half
 * second of nothing before an F2L pair, which is where the time went.
 *
 * The cube is driven by rewriting its setup algorithm to `scramble + the moves
 * so far`, rather than by handing TwistyPlayer an alg and using its own
 * timeline. Two reasons. Scrubbing to an arbitrary moment is then a pure
 * function of the clock, so the slider, the playhead and the move list can never
 * disagree with the cube. And it keeps the player's contract to the one attribute
 * `CubeView` already pushes on every scramble change, which costs no Three.js
 * rebuild — this scrubs at sixty frames a second on the strength of that.
 */

const SPEEDS = [0.25, 0.5, 1, 2] as const;
type Speed = (typeof SPEEDS)[number];

export interface SolveReplayProps {
  scramble: string;
  moves: TimedMove[];
  splits: PhaseSplit[];
  durationMs: number;
}

/** Where each phase sits on the timeline, for the coloured track and the jumps. */
interface Segment {
  phase: string;
  startMs: number;
  endMs: number;
  /** The part before the phase's first turn, when it was measured. See `lookOf`. */
  lookMs: number | null;
}

/**
 * Looking worth drawing: measured, and not the cross, whose looking was
 * inspection and is never inside the clock. The same rule `SolveBreakdown`
 * applies, so the track and the table cannot disagree.
 */
function lookOf(split: PhaseSplit): number | null {
  if (split.phase === "Cross" || split.recognitionMs === undefined) return null;
  return Math.min(split.recognitionMs, split.endMs - split.startMs);
}

/** How far before a pause the jump lands, so the move that ended the last phase is seen. */
const LEAD_IN_MS = 600;

export function SolveReplay({ scramble, moves, splits, durationMs }: SolveReplayProps) {
  const [atMs, setAtMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<Speed>(1);

  // The clock the replay is played against. The last move can land before the
  // timer stopped — the solve is not over until the solver says so — and cutting
  // the replay at the last move would hide that final beat.
  const totalMs = replayLengthMs(moves, durationMs);

  const segments = useMemo<Segment[]>(
    () =>
      splits.map((split) => ({
        phase: split.phase,
        startMs: split.startMs,
        endMs: split.endMs,
        lookMs: lookOf(split),
      })),
    [splits],
  );

  // The one moment most worth watching: the longest stretch spent looking. A
  // replay is forty moves long and the lesson is usually in a single pause.
  const longestLook = useMemo(
    () =>
      segments.reduce<Segment | null>(
        (best, s) => (s.lookMs !== null && s.lookMs > (best?.lookMs ?? 0) ? s : best),
        null,
      ),
    [segments],
  );

  // How many moves have been made by `atMs`. The moves are already in order, so
  // this is the one number every other part of the UI is derived from.
  const played = useMemo(() => movesPlayedBy(moves, atMs), [moves, atMs]);

  const setupAlg = useMemo(() => {
    const done = moves.slice(0, played).map((m) => m.move);
    return done.length > 0 ? `${scramble} ${done.join(" ")}` : scramble;
  }, [scramble, moves, played]);

  // ---------------------------------------------------------------------------
  // The clock
  // ---------------------------------------------------------------------------

  const frame = useRef<number>(0);
  const last = useRef<number>(0);

  useEffect(() => {
    if (!playing) return;

    last.current = performance.now();
    const tick = (now: number) => {
      const elapsed = (now - last.current) * speed;
      last.current = now;

      setAtMs((current) => {
        const next = current + elapsed;
        if (next >= totalMs) {
          setPlaying(false);
          return totalMs;
        }
        return next;
      });
      frame.current = requestAnimationFrame(tick);
    };

    frame.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame.current);
  }, [playing, speed, totalMs]);

  const toggle = useCallback(() => {
    // Pressing play at the end restarts, rather than doing nothing — which is
    // what every video player does and therefore what a hand expects.
    setAtMs((current) => (current >= totalMs ? 0 : current));
    setPlaying((p) => !p);
  }, [totalMs]);

  const scrub = useCallback((ms: number) => {
    setPlaying(false);
    setAtMs(ms);
  }, []);

  // Space to play, arrows to step a move at a time.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;

      if (event.code === "Space") {
        event.preventDefault();
        toggle();
      } else if (event.code === "ArrowLeft") {
        event.preventDefault();
        setPlaying(false);
        setAtMs(played > 0 ? moves[played - 1].atMs : 0);
      } else if (event.code === "ArrowRight") {
        event.preventDefault();
        setPlaying(false);
        setAtMs(played < moves.length ? moves[played].atMs + 1 : totalMs);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle, played, moves, totalMs]);

  const currentPhase = phaseAt(splits, atMs);
  const currentSegment = currentPhase
    ? segments.find((s) => s.phase === currentPhase.phase && s.startMs === currentPhase.startMs)
    : undefined;
  const looking =
    currentSegment?.lookMs != null && atMs < currentSegment.startMs + currentSegment.lookMs;

  const watchLongestLook = useCallback(() => {
    if (!longestLook) return;
    setSpeed(1);
    setAtMs(Math.max(0, longestLook.startMs - LEAD_IN_MS));
    setPlaying(true);
  }, [longestLook]);

  return (
    <div className="flex flex-col gap-5">
      <div className="relative mx-auto aspect-square w-full max-w-md">
        <CubeView
          scramble={setupAlg}
          interactive
          backView="top-right"
          className="h-full w-full"
        />
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Transport                                                           */}
      {/* ------------------------------------------------------------------ */}

      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={toggle}
            aria-label={playing ? "Pause" : "Play"}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-foreground text-background transition-opacity hover:opacity-90"
          >
            {playing ? (
              <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
                <rect x="1" y="0" width="4" height="14" fill="currentColor" />
                <rect x="9" y="0" width="4" height="14" fill="currentColor" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
                <path d="M2 0 L14 7 L2 14 Z" fill="currentColor" />
              </svg>
            )}
          </button>

          <div className="tnum flex items-baseline gap-1.5 font-mono text-sm">
            <span>{formatMs(Math.round(atMs))}</span>
            <span className="text-muted-dim">/ {formatMs(Math.round(totalMs))}</span>
          </div>

          <div className="ml-auto flex items-center gap-1">
            {SPEEDS.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setSpeed(option)}
                aria-pressed={speed === option}
                className={`rounded px-2 py-1 font-mono text-xs transition-colors ${
                  speed === option
                    ? "bg-surface text-foreground"
                    : "text-muted-dim hover:text-muted"
                }`}
              >
                {option}×
              </button>
            ))}
          </div>
        </div>

        {/* The track is the phase breakdown. Seeing that F2L owns two thirds of
            the bar is the same fact as the split table, read in one glance. */}
        <div className="relative">
          <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-surface">
            {segments.map((segment, i) => {
              const length = segment.endMs - segment.startMs;
              return (
                <div
                  key={`${segment.phase}-${i}`}
                  title={
                    segment.lookMs !== null
                      ? `${segment.phase} · ${formatMs(Math.round(segment.lookMs))} looking, ${formatMs(Math.round(length - segment.lookMs))} turning`
                      : `${segment.phase} · ${formatMs(Math.round(length))}`
                  }
                  style={{ width: `${(length / totalMs) * 100}%` }}
                  className={`flex h-full text-muted-dim ${
                    i % 2 === 0 ? "bg-muted-dim/50" : "bg-muted-dim/25"
                  }`}
                >
                  {/* Looking, striped: the pause is drawn where it happened. */}
                  {segment.lookMs !== null && length > 0 ? (
                    <span
                      className="h-full bg-surface"
                      data-look-segment={segment.phase}
                      style={{
                        width: `${(segment.lookMs / length) * 100}%`,
                        backgroundImage:
                          "repeating-linear-gradient(135deg, currentColor 0 2px, transparent 2px 5px)",
                      }}
                    />
                  ) : null}
                </div>
              );
            })}
          </div>

          <div
            aria-hidden="true"
            style={{ left: `${Math.min(100, (atMs / totalMs) * 100)}%` }}
            className="pointer-events-none absolute top-1/2 h-4 w-0.5 -translate-x-1/2 -translate-y-1/2 bg-foreground"
          />

          <input
            type="range"
            min={0}
            max={Math.round(totalMs)}
            value={Math.round(atMs)}
            onChange={(e) => scrub(Number(e.target.value))}
            aria-label="Position in the solve"
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          />
        </div>

        <div className="flex items-baseline justify-between text-xs text-muted-dim">
          <span data-testid="replay-status">
            {currentPhase ? currentPhase.phase : "—"}
            {looking ? <span className="text-holding"> · looking</span> : null} · move {played}{" "}
            of {moves.length}
          </span>
          <span className="hidden sm:inline">space to play, ← → to step</span>
        </div>

        {longestLook?.lookMs ? (
          <button
            type="button"
            onClick={watchLongestLook}
            className="self-start rounded-lg border border-border px-3 py-1.5 text-xs text-muted transition-colors hover:border-muted-dim hover:text-foreground"
          >
            Watch the longest pause —{" "}
            <span className="tnum font-mono text-foreground">
              {formatMs(Math.round(longestLook.lookMs))}
            </span>{" "}
            before {longestLook.phase}
          </button>
        ) : null}
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* The stream itself                                                   */}
      {/* ------------------------------------------------------------------ */}

      {moves.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {moves.map((move, i) => {
            const done = i < played;
            const current = i === played - 1;
            return (
              <button
                key={i}
                type="button"
                onClick={() => scrub(move.atMs + 1)}
                title={formatMs(Math.round(move.atMs))}
                className={`rounded px-1.5 py-1 font-mono text-xs tabular-nums transition-colors ${
                  current
                    ? "bg-foreground text-background"
                    : done
                      ? "text-foreground hover:bg-surface"
                      : "text-muted-dim hover:bg-surface"
                }`}
              >
                {move.move}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
