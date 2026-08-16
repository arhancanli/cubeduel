"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { CubePlayer } from "@/components/CubeView";
import { analyzeSolve, type PhaseSplit, type SolveAnalysis } from "@/lib/cfop";
import { CubeStateTracker, warmCubeState } from "@/lib/cubeState";
import { formatMs, formatRunning } from "@/lib/format";
import { BINDINGS_BY_CODE } from "@/lib/keyMap";
import {
  SolveRecorder,
  type RecorderPhase,
  type SolveRecording,
} from "@/lib/moveStream";
import {
  connectKeyboard,
  connectSmartCube,
  smartCubeSupport,
  type ConnectedPuzzle,
  type SmartCubeSupport,
} from "@/lib/puzzleSource";
import { useLatest } from "./useLatest";

/**
 * One solve loop, used by every mode that solves a cube.
 *
 * Practice and ranked differ in exactly two ways: where the scramble comes from,
 * and what happens when the solve finishes. Everything between those two points —
 * connecting an input device, seeding the state tracker, arming the recorder,
 * painting the clock at 60fps, detecting the solved state, splitting the solve
 * into phases — is identical, and was previously going to be copied.
 *
 * Copying it would have been the expensive kind of duplication: the parts most
 * worth sharing are the ones with a comment explaining why they are the way they
 * are, and a copy inherits the code without inheriting the reason. The first time
 * one copy got a fix the other would silently become the buggy mode.
 *
 * So the two variable parts are parameters and the rest lives here once.
 */

export interface SolveOutcome {
  scramble: string;
  recording: SolveRecording;
  analysis: SolveAnalysis;
  source: "keyboard" | "smartcube";
}

export interface SolveSessionOptions {
  /** Where the next puzzle comes from. Local generator, or the server for ranked. */
  nextScramble: () => Promise<string>;
  /** Runs once per finished solve, after the phase split has been attempted. */
  onSolved?: (outcome: SolveOutcome) => void;
  /** Reported to the caller when a round cannot be started at all. */
  onRoundError?: (message: string) => void;
}

export interface SolveSession {
  scramble: string;
  phase: RecorderPhase;
  moveCount: number;
  recording: SolveRecording | null;
  splits: PhaseSplit[] | null;
  sourceName: string | null;
  connectError: string | null;
  support: SmartCubeSupport | null;
  activeKey: string | null;
  /** The clock is painted straight into this node — see `tick` below. */
  displayRef: React.RefObject<HTMLDivElement | null>;
  onPlayerReady: (player: CubePlayer | null) => void;
  startRound: () => Promise<void>;
  connectCube: () => Promise<void>;
  /** For the on-screen move pad, which is not a real input device. */
  pushMove: (move: string) => void;
  /** The scramble currently being solved, readable without a re-render. */
  scrambleRef: React.RefObject<string>;
}

export function useSolveSession(options: SolveSessionOptions): SolveSession {
  const [scramble, setScramble] = useState("");
  const [phase, setPhase] = useState<RecorderPhase>("idle");
  const [recording, setRecording] = useState<SolveRecording | null>(null);
  const [splits, setSplits] = useState<PhaseSplit[] | null>(null);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [sourceName, setSourceName] = useState<string | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [moveCount, setMoveCount] = useState(0);

  const displayRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<CubePlayer | null>(null);
  const trackerRef = useRef<CubeStateTracker | null>(null);
  const sourceRef = useRef<ConnectedPuzzle | null>(null);
  const rafRef = useRef<number | null>(null);
  const scrambleRef = useRef("");
  /** Moves already fed to the tracker, in order. */
  const appliedRef = useRef<string[]>([]);

  // Held in a ref so the mount-only input effect always calls the current
  // callbacks without being torn down and reconnected on every render.
  const optionsRef = useLatest(options);

  const recorderRef = useRef<SolveRecorder | null>(null);
  if (recorderRef.current === null) {
    recorderRef.current = new SolveRecorder();
  }

  // Resolved after mount, never during render: `navigator` does not exist on the
  // server, so probing it inline makes the server and client trees disagree and
  // React throws away the hydrated tree.
  const [support, setSupport] = useState<SmartCubeSupport | null>(null);
  useEffect(() => setSupport(smartCubeSupport()), []);

  const paint = useCallback((text: string) => {
    if (displayRef.current) displayRef.current.textContent = text;
  }, []);

  const stopRaf = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  /**
   * The running time is written straight to a DOM node inside the frame callback.
   * A 60fps `setState` would re-render the whole screen every frame, and the timer
   * is the one place jank is unforgivable.
   */
  const tick = useCallback(() => {
    const recorder = recorderRef.current!;
    paint(formatRunning(recorder.elapsedAt(performance.now())));
    rafRef.current = requestAnimationFrame(tick);
  }, [paint]);

  const startRound = useCallback(async () => {
    stopRaf();
    setRecording(null);
    setSplits(null);
    setMoveCount(0);
    paint("0.00");

    // The player accumulates the solver's moves in its `alg`; replacing only the
    // setup would leave the previous round's turns applied on top of the new
    // scramble, so from round two the cube on screen was not the cube being judged.
    // Removed rather than set to "": cubing.js parses the attribute, and an empty
    // string throws "internal parsing error" on every new round.
    playerRef.current?.removeAttribute("alg");
    appliedRef.current = [];

    let next: string;
    try {
      next = await optionsRef.current.nextScramble();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      optionsRef.current.onRoundError?.(message);
      setPhase("idle");
      return;
    }

    scrambleRef.current = next;
    setScramble(next);

    if (trackerRef.current) {
      trackerRef.current.reset(next);
    } else {
      trackerRef.current = await CubeStateTracker.create(next);
    }

    recorderRef.current!.arm();
    setPhase("armed");
  }, [paint, stopRaf, optionsRef]);

  const handleMove = useCallback(
    (move: string, timestamp: number) => {
      const tracker = trackerRef.current;
      const recorder = recorderRef.current!;
      if (!tracker || recorder.getPhase() === "idle") return;

      // The visual cube follows the input; the tracker is the source of truth for
      // whether the puzzle is actually solved.
      appliedRef.current.push(move);
      playerRef.current?.experimentalAddMove(move);
      const solved = tracker.applyMove(move);
      const wasRunning = recorder.getPhase() === "running";

      recorder.handleMove(move, timestamp, solved);

      const nowRunning = recorder.getPhase() === "running";
      if (!wasRunning && nowRunning) {
        setPhase("running");
        stopRaf();
        rafRef.current = requestAnimationFrame(tick);
      }
      setMoveCount(recorder.getMoves().filter((m) => !m.rotation).length);

      if (recorder.getPhase() === "solved") {
        stopRaf();
        const result = recorder.getRecording();
        paint(formatMs(result.durationMs));
        setRecording(result);
        setPhase("solved");

        const solvedScramble = scrambleRef.current;
        const source = sourceRef.current?.kind ?? "keyboard";

        // Replayed after the fact rather than tracked live, so a pair that was
        // broken and reinserted is credited where the work actually happened.
        const finish = (analysis: SolveAnalysis) => {
          setSplits(analysis.splits);
          optionsRef.current.onSolved?.({
            scramble: solvedScramble,
            recording: result,
            analysis,
            source,
          });
        };

        void analyzeSolve(
          solvedScramble,
          result.moves.map((m) => ({ move: m.move, atMs: m.atMs })),
        )
          .then(finish)
          // A solve that cannot be split is still a solve. Dropping it would
          // quietly bias the record toward clean CFOP solves.
          .catch(() =>
            finish({
              splits: [],
              ollCase: null,
              pllCase: null,
              ollSetup: null,
              pllSetup: null,
            }),
          );
      }
    },
    [paint, stopRaf, tick, optionsRef],
  );

  const handleMoveRef = useLatest(handleMove);

  // Highlight the pressed key so the layout is learned by using it.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!BINDINGS_BY_CODE.has(event.code)) return;
      setActiveKey(event.code);
    };
    const onKeyUp = () => setActiveKey(null);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  useEffect(() => {
    warmCubeState();
    let cancelled = false;

    (async () => {
      try {
        const puzzle = await connectKeyboard(document.body);
        if (cancelled) {
          puzzle.disconnect();
          return;
        }
        sourceRef.current = puzzle;
        setSourceName(puzzle.name);
        puzzle.onMove((move, timestamp) => handleMoveRef.current(move, timestamp));
      } catch {
        if (!cancelled) {
          setConnectError("Keyboard cubing could not start. Try reloading.");
        }
      }
    })();

    void startRound();

    return () => {
      cancelled = true;
      sourceRef.current?.disconnect();
      sourceRef.current = null;
      stopRaf();
    };
    // Deliberately mount-only: reconnecting the input on every render would drop
    // moves mid-solve.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const connectCube = useCallback(async () => {
    setConnectError(null);
    try {
      const puzzle = await connectSmartCube();
      sourceRef.current?.disconnect();
      sourceRef.current = puzzle;
      setSourceName(puzzle.name);
      puzzle.onMove((move, timestamp) => handleMoveRef.current(move, timestamp));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // A cancelled device picker is a normal user action, not a failure.
      if (!/cancel/i.test(message)) setConnectError(message);
    }
  }, [handleMoveRef]);

  const pushMove = useCallback(
    (move: string) => {
      handleMoveRef.current(move, performance.now());
    },
    [handleMoveRef],
  );

  const onPlayerReady = useCallback((player: CubePlayer | null) => {
    playerRef.current = player;
  }, []);

  return {
    scramble,
    phase,
    moveCount,
    recording,
    splits,
    sourceName,
    connectError,
    support,
    activeKey,
    displayRef,
    onPlayerReady,
    startRound,
    connectCube,
    pushMove,
    scrambleRef,
  };
}
