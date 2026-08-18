"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { CubeStateTracker, warmCubeState } from "./cubeState";
import { SolveRecorder, type SolveRecording } from "./moveStream";
import { connectKeyboard, type ConnectedPuzzle } from "./puzzleSource";
import { useLatest } from "./useLatest";

/**
 * A solve the app can actually verify.
 *
 * A stopwatch cannot know whether a cube was solved — an idle tab produces a
 * perfectly good-looking 4.00, and the daily was handing that result a share string
 * as if it had been checked. Here the app watches the puzzle itself: the clock
 * starts on the first turn and stops only when the cube genuinely reaches a solved
 * state, so a result either happened or does not exist.
 *
 * That distinction is what makes a shared daily time worth anything, and it is the
 * prerequisite for ever ranking one.
 */
export function useKeyboardSolve({
  scramble,
  active,
  completion = "solved",
  onSolved,
  onMove,
  displayRef,
  format,
}: {
  scramble: string;
  /** Only connects and records while true. */
  active: boolean;
  /**
   * What counts as finished.
   *
   * `"solved"` is a whole solve. `"oriented"` ends the moment the last layer is
   * one flat colour, which is what an OLL drill is — waiting for the cube to be
   * fully solved would silently fold PLL time into every OLL rep and make the
   * case times the trainer schedules on simply wrong.
   */
  completion?: "solved" | "oriented";
  onSolved: (recording: SolveRecording) => void;
  onMove?: (move: string) => void;
  /** Painted directly with the running time, bypassing React re-renders. */
  displayRef?: React.RefObject<HTMLElement | null>;
  format?: (ms: number) => string;
}) {
  const [running, setRunning] = useState(false);
  const [moveCount, setMoveCount] = useState(0);

  const trackerRef = useRef<CubeStateTracker | null>(null);
  const sourceRef = useRef<ConnectedPuzzle | null>(null);
  const recorderRef = useRef<SolveRecorder | null>(null);
  if (recorderRef.current === null) recorderRef.current = new SolveRecorder();

  const rafRef = useRef<number | null>(null);
  const onSolvedRef = useLatest(onSolved);
  const onMoveRef = useLatest(onMove);

  /**
   * The move handler, held so a caller can drive it directly.
   *
   * Everything a solve needs — the tracker, the recorder, the clock — is set up
   * inside the effect below, which used to mean the keyboard was the only thing
   * that could reach it. That is why the daily and the trainer had no touch
   * input: not a design decision, just a closure nothing else could get at.
   */
  const handleMoveRef = useRef<((move: string, timestamp: number) => void) | null>(
    null,
  );

  /** Elapsed milliseconds right now, for a live display. */
  const elapsed = useCallback(
    () => recorderRef.current!.elapsedAt(performance.now()),
    [],
  );

  useEffect(() => {
    if (!active || !scramble) return;
    warmCubeState();
    let cancelled = false;

    (async () => {
      const tracker = await CubeStateTracker.create(scramble);
      if (cancelled) return;
      trackerRef.current = tracker;

      const recorder = recorderRef.current!;
      recorder.arm();

      const puzzle = await connectKeyboard(document.body);
      if (cancelled) {
        puzzle.disconnect();
        return;
      }
      sourceRef.current = puzzle;

      const handleMove = (move: string, timestamp: number) => {
        const wasRunning = recorder.getPhase() === "running";
        tracker.applyMove(move);
        const solved =
          completion === "oriented"
            ? tracker.isLastLayerOriented()
            : tracker.isSolved();
        recorder.handleMove(move, timestamp, solved);
        onMoveRef.current?.(move);

        if (!wasRunning && recorder.getPhase() === "running") {
          setRunning(true);
          // Painted straight to the node in rAF: a 60fps setState would re-render
          // the page every frame, and the clock is the one place jank shows.
          const tick = () => {
            const node = displayRef?.current;
            if (node && format) {
              node.textContent = format(recorder.elapsedAt(performance.now()));
            }
            rafRef.current = requestAnimationFrame(tick);
          };
          rafRef.current = requestAnimationFrame(tick);
        }
        setMoveCount(recorder.getMoves().filter((m) => !m.rotation).length);

        if (recorder.getPhase() === "solved") {
          setRunning(false);
          if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
          rafRef.current = null;
          const done = recorder.getRecording();
          const node = displayRef?.current;
          if (node && format) node.textContent = format(done.durationMs);
          onSolvedRef.current(done);
        }
      };

      handleMoveRef.current = handleMove;
      puzzle.onMove(handleMove);
    })();

    return () => {
      cancelled = true;
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      sourceRef.current?.disconnect();
      sourceRef.current = null;
      handleMoveRef.current = null;
    };
  }, [active, scramble, completion, displayRef, format, onMoveRef, onSolvedRef]);

  /**
   * Applies a move from something that is not a key press.
   *
   * Same path as a keyboard turn, deliberately: the touch pad must not be a
   * second implementation that can drift from the one being timed. A no-op
   * before the solve is connected, which is the correct answer to a tap that
   * arrives early.
   */
  const pushMove = useCallback((move: string) => {
    handleMoveRef.current?.(move, performance.now());
  }, []);

  return { running, moveCount, elapsed, pushMove };
}
