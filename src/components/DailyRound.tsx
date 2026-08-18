"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { CubeView } from "@/components/CubeView";
import { DailyMemory, readDailyStats } from "@/components/DailyMemory";
import { SiteHeader } from "@/components/SiteHeader";
import {
  buildDailyShare,
  formatCountdown,
  msUntilNextUtcDay,
  crossDifficultyLabel,
  speedTier,
  TIER_MAX,
  tierLabel,
} from "@/lib/daily";
import { formatMs, formatRunning } from "@/lib/format";
import {
  abandonToDnf,
  getEntry,
  markStarted,
  recordResult,
  type DailyEntry,
} from "@/lib/dailyStorage";
import { analyzeSolve, type PhaseSplit, type SolveAnalysis } from "@/lib/cfop";
import { SolveBreakdown } from "@/components/SolveBreakdown";
import { recordSolve } from "@/lib/solveHistory";
import { submitDailyResult } from "@/lib/sync";
import { useKeyboardSolve } from "@/lib/useKeyboardSolve";
import { useSpeedTimer } from "@/lib/useSpeedTimer";

type Stage = "loading" | "intro" | "solving" | "done";
/**
 * How the attempt is being made.
 *
 * "hand" is a stopwatch: the player times their own physical cube, and the app has
 * to take their word for it — an idle tab produces a convincing result. "keyboard"
 * is watched: the clock stops only when the cube genuinely reaches solved, so the
 * result either happened or does not exist. Both are offered because excluding
 * physical cubes would be absurd, and the difference is stated rather than hidden.
 */
type Mode = "hand" | "keyboard";

interface Props {
  dayKey: string;
  dayNumber: number;
  startKey: string;
  scramble: string | null;
  /** Optimal cross length for the easiest face, precomputed at build time. */
  crossMoves: number | null;
  /** Shortest solution the engine found. Null when it could not be computed. */
  optimalMoves: number | null;
}

export function DailyRound({
  dayKey,
  dayNumber,
  startKey,
  scramble,
  crossMoves,
  optimalMoves,
}: Props) {
  const [stage, setStage] = useState<Stage>("loading");
  const [entry, setEntry] = useState<DailyEntry | null>(null);
  const [copied, setCopied] = useState(false);
  const [remaining, setRemaining] = useState(0);
  const startedRef = useRef(false);
  const [mode, setMode] = useState<Mode>("hand");
  const [stats, setStats] = useState<ReturnType<typeof readDailyStats> | null>(null);

  useEffect(() => {
    const existing = getEntry(dayKey);
    if (existing?.status === "done") {
      setEntry(existing);
      setStage("done");
      return;
    }
    if (existing?.status === "started") {
      // Left mid-attempt. One attempt means one attempt.
      abandonToDnf(dayKey);
      setEntry(getEntry(dayKey));
      setStage("done");
      return;
    }
    setStage("intro");
  }, [dayKey]);

  useEffect(() => {
    setStats(readDailyStats(dayKey));
  }, [dayKey, entry]);

  useEffect(() => {
    const update = () => setRemaining(msUntilNextUtcDay());
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, []);

  const verifiedRef = useRef(false);
  /**
   * Where the time went, for keyboard solves.
   *
   * The daily recorded `splits: []` until now, so the one round a lot of people
   * play was also the only one that told them nothing — and it was invisible in
   * the progress analysis for the same reason.
   */
  const [splits, setSplits] = useState<PhaseSplit[]>([]);

  const handleComplete = useCallback(
    (ms: number, moves?: { move: string; atMs: number }[]) => {
      recordResult(dayKey, ms, "OK", verifiedRef.current);

      // Sent to the shared board, where the one-attempt rule is a primary key
      // rather than a local promise. Fire-and-forget: the round is already
      // recorded locally and already on screen, so a network failure must not
      // turn a finished daily into an error about something nobody can act on.
      void submitDailyResult({
        dayKey,
        durationMs: ms,
        penalty: "OK",
        // Only keyboard solves carry a stream. A hand-timed result has nothing
        // to prove itself with and is stored unverified, which the board says.
        moves,
      });
      // The daily is still a solve. Keeping it out of history meant a player whose
      // only habit was the daily saw an empty analysis page forever.
      const store = (analysis: SolveAnalysis) => {
        setSplits(analysis.splits);
        recordSolve({
          scramble: scramble ?? "",
          durationMs: ms,
          penalty: "OK",
          moveCount: moves?.length ?? 0,
          tps: moves && ms > 0 ? moves.length / (ms / 1000) : 0,
          splits: analysis.splits,
          ollCase: analysis.ollCase,
          pllCase: analysis.pllCase,
          ollSetup: analysis.ollSetup,
          pllSetup: analysis.pllSetup,
          source: "keyboard",
        });
      };

      if (moves && moves.length > 0 && scramble) {
        // Replayed after the fact rather than tracked live, so a pair broken and
        // reinserted is credited where the work actually happened.
        void analyzeSolve(scramble, moves)
          .then(store)
          // A solve that cannot be split is still a solve. Dropping it would bias
          // the record toward clean CFOP solves.
          .catch(() =>
            store({ splits: [], ollCase: null, pllCase: null, ollSetup: null, pllSetup: null, crossFace: null }),
          );
      } else {
        // Hand-timed: no move stream, so nothing to split.
        store({ splits: [], ollCase: null, pllCase: null, ollSetup: null, pllSetup: null, crossFace: null });
      }

      setEntry(getEntry(dayKey));
      setStage("done");
    },
    [dayKey, scramble],
  );

  /**
   * Escape abandons the run. The attempt was committed the moment the clock
   * started, so abandoning resolves to a DNF rather than handing back a fresh try —
   * without this, Escape then space was an unlimited retry with no devtools needed.
   */
  const handleCancel = useCallback(() => {
    abandonToDnf(dayKey);
    void submitDailyResult({ dayKey, durationMs: 0, penalty: "DNF" });
    setEntry(getEntry(dayKey));
    setStage("done");
  }, [dayKey]);

  const { phase, displayRef, touchHandlers } = useSpeedTimer({
    // Adapted rather than passed straight through: the speed timer's second
    // argument is its own phase splits, which are not a move stream.
    onComplete: (ms: number) => handleComplete(ms),
    onCancel: handleCancel,
    enabled: stage === "solving" && mode === "hand",
  });

  // Both hooks are always called — only one is ever active.
  const keyboard = useKeyboardSolve({
    scramble: scramble ?? "",
    active: stage === "solving" && mode === "keyboard",
    displayRef,
    format: formatRunning,
    onSolved: (recording) => {
      verifiedRef.current = true;
      markStarted(dayKey);
      handleComplete(
        recording.durationMs,
        recording.moves.map((m) => ({ move: m.move, atMs: m.atMs })),
      );
    },
  });

  // The attempt is committed the moment the clock starts, not when it stops.
  useEffect(() => {
    if (keyboard.running && !startedRef.current) {
      startedRef.current = true;
      markStarted(dayKey);
    }
  }, [dayKey, keyboard.running]);

  useEffect(() => {
    if (phase === "running" && !startedRef.current) {
      startedRef.current = true;
      markStarted(dayKey);
    }
  }, [dayKey, phase]);

  const effective = useMemo(() => {
    if (!entry || entry.status !== "done") return null;
    if (entry.penalty === "DNF") return null;
    return entry.penalty === "PLUS2" ? entry.ms + 2000 : entry.ms;
  }, [entry]);

  const share = useCallback(async () => {
    if (!entry || entry.status !== "done") return;
    const host = typeof window === "undefined" ? "cubeduel.app" : window.location.host;
    const text = buildDailyShare(
      {
        dayKey,
        ms: entry.ms,
        penalty: entry.penalty,
        verified: entry.status === "done" && entry.verified,
      },
      startKey,
      splits,
      host,
    );
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* Clipboard blocked — the text is still shown on screen to copy by hand. */
    }
    // `splits` is a real dependency, not lint noise: the CFOP analysis resolves
    // asynchronously and lands AFTER the result does, so a callback that closed
    // over the initial empty array would quietly share the plain speed bar even
    // for a solve that had a full breakdown ready.
  }, [dayKey, entry, startKey, splits]);

  if (!scramble) {
    return (
      <Shell dayNumber={dayNumber} dayKey={dayKey}>
        <p className="text-center text-sm text-muted">
          No scramble is published for {dayKey} yet.
        </p>
      </Shell>
    );
  }

  if (stage === "loading") {
    return <Shell dayNumber={dayNumber} dayKey={dayKey}>{null}</Shell>;
  }

  if (stage === "intro") {
    return (
      <Shell dayNumber={dayNumber} dayKey={dayKey}>
        <div className="flex flex-col items-center gap-6 text-center">
          <p className="max-w-sm text-sm leading-relaxed text-muted">
            One attempt. The scramble is the same for everyone today, and your time is
            final the moment the timer starts — leaving mid-solve counts as a DNF.
          </p>
          <div className="flex flex-col items-center gap-3">
            <div className="flex flex-wrap items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => {
                  setMode("hand");
                  setStage("solving");
                }}
                className="rounded-lg bg-foreground px-6 py-3 text-sm font-medium text-background transition-opacity hover:opacity-90"
              >
                Solve with my cube
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode("keyboard");
                  setStage("solving");
                }}
                className="rounded-lg border border-border px-6 py-3 text-sm text-muted transition-colors hover:border-muted-dim hover:text-foreground"
              >
                Solve on the keyboard
              </button>
            </div>
            <p className="max-w-sm text-xs leading-relaxed text-muted-dim">
              A hand-timed result is your own word for it. A keyboard solve is watched
              to the finish, so it shares with a ✓.
            </p>
          </div>
          {crossMoves !== null ? (
            <p className="text-xs text-muted-dim">
              Today&apos;s cross is{" "}
              <span className="text-muted">{crossDifficultyLabel(crossMoves)}</span> —{" "}
              {crossMoves} moves on the easiest face.
            </p>
          ) : null}
          {/*
            How short today's cube can be solved, from this app's own engine.
            It gives nothing away — a length is not a solution — and it is the
            only number here that describes the puzzle rather than the player.
          */}
          {optimalMoves !== null ? (
            <p className="text-xs text-muted-dim">
              The whole cube can be solved in{" "}
              <span className="text-muted">{optimalMoves} moves</span>. A human
              method takes three or four times that.
            </p>
          ) : null}
          <Countdown remaining={remaining} />
          {stats ? <DailyMemory stats={stats} todayKey={dayKey} className="pt-4" /> : null}
        </div>
      </Shell>
    );
  }

  if (stage === "solving") {
    const solving =
      mode === "keyboard"
        ? keyboard.running
        : phase === "holding" || phase === "ready" || phase === "running";
    const timeColor =
      phase === "ready" ? "text-ready" : phase === "holding" ? "text-holding" : "text-foreground";

    return (
      <Shell dayNumber={dayNumber} dayKey={dayKey} hideChrome={solving}>
        <div
          className="no-select flex flex-col items-center gap-10"
          style={{ touchAction: "manipulation" }}
          {...touchHandlers}
        >
          <div
            className={`mx-auto flex max-w-5xl flex-wrap items-center justify-center gap-x-3 gap-y-1.5 text-center font-mono text-lg leading-snug sm:text-xl md:text-2xl ${
              solving ? "solving-hidden" : "solving-visible"
            }`}
          >
            {scramble.split(" ").map((move, i) => (
              <span key={`${move}-${i}`}>{move}</span>
            ))}
          </div>

          <CubeView
            scramble={scramble}
            className={`h-[22vh] max-h-56 min-h-32 w-full max-w-lg ${
              solving ? "solving-hidden" : "solving-visible"
            }`}
          />
          <div
            ref={displayRef as React.RefObject<HTMLDivElement>}
            className={`tnum text-7xl font-medium tracking-tighter transition-colors duration-100 sm:text-8xl ${timeColor}`}
          >
            0.00
          </div>
          <p className={`text-xs text-muted-dim ${solving ? "solving-hidden" : "solving-visible"}`}>
            {mode === "keyboard"
              ? "Turn the cube with your keyboard — J U · F U' · I R · K R' · D L · E L' · H F · G F' · S D · L D' · W B · O B'. The clock starts on your first turn and stops when it's solved."
              : "Hold space — or press and hold anywhere — until it turns green, then release."}
          </p>
        </div>
      </Shell>
    );
  }

  // Only a real personal best — a first-ever daily is not "a best".
  const isDailyBest =
    effective !== null &&
    stats !== null &&
    stats.played > 1 &&
    stats.bestMs !== null &&
    effective <= stats.bestMs;

  const filled = speedTier(effective);

  return (
    <Shell dayNumber={dayNumber} dayKey={dayKey}>
      <div className="flex flex-col items-center gap-8 text-center">
        <div className="flex flex-col items-center gap-2">
          <span className="tnum text-6xl font-medium tracking-tighter sm:text-7xl">
            {effective === null ? "DNF" : formatMs(effective)}
          </span>
          <span className="text-xs uppercase tracking-widest text-muted-dim">
            {tierLabel(effective)}
          </span>
          {isDailyBest ? (
            <span className="text-xs uppercase tracking-widest text-ready">
              Best daily yet
            </span>
          ) : null}
          {/*
            The same shape that goes in the share, on screen first. Nobody should
            be pasting a picture of their solve into a group chat without having
            understood it themselves — and it is the part of the result that
            actually tells them what to practise.
          */}
          {splits.length > 0 ? <SolveBreakdown splits={splits} /> : null}
          {entry?.status === "done" ? (
            <span
              className={`text-xs ${entry.verified ? "text-ready" : "text-muted-dim"}`}
              title={
                entry.verified
                  ? "The app watched this cube reach a solved state."
                  : "Hand-timed. The app cannot check a physical cube, so this is your own record of it."
              }
            >
              {entry.verified ? "✓ Verified solve" : "Self-timed"}
            </span>
          ) : null}
        </div>

        <div className="flex gap-1.5" aria-label={`${filled} of ${TIER_MAX} speed tiers`}>
          {Array.from({ length: TIER_MAX }, (_, i) => (
            <span
              key={i}
              className={`h-3 w-8 rounded-sm ${i < filled ? "bg-ready" : "bg-surface-hi"}`}
            />
          ))}
        </div>

        <button
          type="button"
          onClick={share}
          className="rounded-lg bg-foreground px-6 py-3 text-sm font-medium text-background transition-opacity hover:opacity-90"
        >
          {copied ? "Copied" : "Share result"}
        </button>

        {stats ? <DailyMemory stats={stats} todayKey={dayKey} /> : null}

        <Countdown remaining={remaining} />

        <Link href="/timer" className="text-xs text-muted-dim underline-offset-4 hover:underline">
          Keep practising →
        </Link>
      </div>
    </Shell>
  );
}

function Countdown({ remaining }: { remaining: number }) {
  return (
    <p className="tnum text-xs text-muted-dim">
      Next scramble in {formatCountdown(remaining)}
    </p>
  );
}

function Shell({
  dayNumber,
  dayKey,
  hideChrome = false,
  children,
}: {
  dayNumber: number;
  dayKey: string;
  hideChrome?: boolean;
  children: React.ReactNode;
}) {
  return (
    <main className="flex min-h-dvh flex-col">
      <SiteHeader active="daily" fade={hideChrome} trailing={`daily #${dayNumber} · ${dayKey}`} />
      {/* The round has several stages with their own headings; this names the
          page itself, which none of them do. Hidden because the date already
          sits in the header and repeating it would be clutter. */}
      <h1 className="sr-only">{`Daily scramble #${dayNumber}`}</h1>
      <div className="flex flex-1 items-center justify-center px-6 pb-16">{children}</div>
    </main>
  );
}
