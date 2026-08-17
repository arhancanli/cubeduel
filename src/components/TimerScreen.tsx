"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { CubeView } from "@/components/CubeView";
import type { PhaseSplit } from "@/lib/cfop";
import { SiteHeader } from "@/components/SiteHeader";
import { SolveReviewPanel } from "@/components/SolveReview";
import { formatAverage, formatMs, formatSolve } from "@/lib/format";
import { nextScramble, warmScrambles } from "@/lib/scramble";
import { ao5, ao12, bestSingle, effectiveMs } from "@/lib/stats";
import { loadHistory, recordSolve, removeSolve, updateSolvePenalty } from "@/lib/solveHistory";
import { reviewSolve, type SolveReview } from "@/lib/solveReview";
import { loadState, newSolve, saveState, type PersistedState } from "@/lib/storage";
import type { Penalty, Solve } from "@/lib/types";
import { useSpeedTimer } from "@/lib/useSpeedTimer";
import { useLatest } from "@/lib/useLatest";

const RECENT_COUNT = 12;

/** CFOP stages, in order. These names match what the analyser groups on. */
const SPLIT_LABELS = ["Cross", "F2L", "OLL", "PLL"] as const;
const SPLIT_MODE_KEY = "cubeduel.splitMode.v1";

/**
 * Turns cumulative lap times into phase splits.
 *
 * Move counts are left at zero and reported as unknown rather than guessed — a
 * stopwatch genuinely cannot see turns, and inventing a number here would put a
 * fabricated TPS next to a measured time.
 */
function buildSplits(laps: number[]): PhaseSplit[] {
  const splits: PhaseSplit[] = [];
  let prev = 0;
  SPLIT_LABELS.forEach((label, i) => {
    const end = laps[i];
    if (end === undefined) return;
    splits.push({
      phase: label,
      startMs: prev,
      endMs: end,
      durationMs: end - prev,
      moveCount: 0,
      tps: 0,
    });
    prev = end;
  });
  return splits;
}

export function TimerScreen() {
  const [state, setState] = useState<PersistedState | null>(null);
  const [scramble, setScramble] = useState<string>("");
  const [scrambleError, setScrambleError] = useState(false);
  const [splitMode, setSplitMode] = useState(false);
  const [review, setReview] = useState<SolveReview | null>(null);

  // The scramble that was on screen when the timer started — the one the solve is
  // actually for. Held in a ref so prefetching the next one can't swap it mid-solve.
  const activeScrambleRef = useRef("");

  const session = state ? state.sessions.find((s) => s.id === state.activeSessionId) : undefined;
  const solves = useMemo(() => session?.solves ?? [], [session]);

  const nextRound = useCallback(() => {
    setReview(null);
  }, []);

  const advanceScramble = useCallback(async () => {
    try {
      const next = await nextScramble("333");
      setScramble(next);
      setScrambleError(false);
    } catch {
      setScrambleError(true);
    }
  }, []);

  useEffect(() => {
    setState(loadState());
    warmScrambles("333");
    void advanceScramble();
    try {
      setSplitMode(window.localStorage.getItem(SPLIT_MODE_KEY) === "1");
    } catch {
      /* Private mode — the default is fine. */
    }
  }, [advanceScramble]);

  const toggleSplitMode = useCallback(() => {
    setSplitMode((on) => {
      const next = !on;
      try {
        window.localStorage.setItem(SPLIT_MODE_KEY, next ? "1" : "0");
      } catch {
        /* Preference is not worth failing a solve over. */
      }
      return next;
    });
  }, []);

  useEffect(() => {
    activeScrambleRef.current = scramble;
  }, [scramble]);

  // Held in a ref so `nextRound` can stay stable across renders.
  const advanceScrambleRef = useLatest(advanceScramble);

  const mutateSolves = useCallback((fn: (solves: Solve[]) => Solve[]) => {
    setState((current) => {
      if (!current) return current;
      const next: PersistedState = {
        ...current,
        sessions: current.sessions.map((s) =>
          s.id === current.activeSessionId ? { ...s, solves: fn(s.solves) } : s,
        ),
      };
      saveState(next);
      return next;
    });
  }, []);

  const handleComplete = useCallback(
    (ms: number, laps: number[]) => {
      const splits = laps.length > 0 ? buildSplits(laps) : [];
      // Reviewed against history as it stood *before* this solve — a par that this
      // solve helped set would flatten its own gap toward zero.
      setReview(reviewSolve(splits, ms, loadHistory()));

      const solved = newSolve(ms, activeScrambleRef.current, "333");
      // The next scramble is issued immediately even though the review is on screen.
      // A cuber doing fifty solves in a session holds space again without looking, and
      // making them dismiss a panel first would tax the loop far more than the review
      // is worth. "Again" then only has to clear the panel.
      void advanceScrambleRef.current();
      mutateSolves((list) => [...list, solved]);
      // Also to the shared history, sharing the session solve's id so a penalty
      // applied afterwards can amend the same record. A hand-timed solve carries no
      // move stream, so it has no phase splits — it still counts toward totals,
      // bests and trend, and the phase analysis simply skips it.
      recordSolve({
        id: solved.id,
        scramble: solved.scramble,
        durationMs: ms,
        penalty: "OK",
        moveCount: 0,
        tps: 0,
        splits,
        ollCase: null,
        pllCase: null,
        ollSetup: null,
        pllSetup: null,
        source: "keyboard",
      });
    },
    [mutateSolves, advanceScrambleRef],
  );

  const splitLabels = useMemo(() => (splitMode ? SPLIT_LABELS : []), [splitMode]);

  const { phase, splitIndex, displayRef, touchHandlers, setDisplayedTime } = useSpeedTimer({
    onComplete: handleComplete,
    splitLabels,
    enabled: state !== null,
  });

  const lastSolve = solves.length > 0 ? solves[solves.length - 1] : null;

  const setPenalty = useCallback(
    (penalty: Penalty) => {
      if (!lastSolve) return;
      const nextPenalty = lastSolve.penalty === penalty ? "OK" : penalty;
      mutateSolves((list) =>
        list.map((s, i) => (i === list.length - 1 ? { ...s, penalty: nextPenalty } : s)),
      );
      updateSolvePenalty(lastSolve.id, nextPenalty);
      setDisplayedTime(
        effectiveMs({ ...lastSolve, penalty: nextPenalty }),
        nextPenalty === "DNF" ? "DNF" : null,
      );
    },
    [lastSolve, mutateSolves, setDisplayedTime],
  );

  const deleteLast = useCallback(() => {
    if (!lastSolve) return;
    removeSolve(lastSolve.id);
    mutateSolves((list) => list.slice(0, -1));
    const previous = solves.length >= 2 ? solves[solves.length - 2] : null;
    setDisplayedTime(
      previous ? effectiveMs(previous) : null,
      previous?.penalty === "DNF" ? "DNF" : null,
    );
  }, [lastSolve, mutateSolves, setDisplayedTime, solves]);

  // Power-user keys, live only while the timer is parked so they can never be
  // mistaken for a stop.
  useEffect(() => {
    if (phase !== "idle" || !lastSolve) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "2") setPenalty("PLUS2");
      else if (event.key.toLowerCase() === "d") setPenalty("DNF");
      else if (event.key === "Backspace" || event.key === "Delete") deleteLast();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [deleteLast, lastSolve, phase, setPenalty]);

  const chromeHidden = phase === "holding" || phase === "ready" || phase === "running";
  const chromeClass = chromeHidden ? "solving-hidden" : "solving-visible";

  const timeColor =
    phase === "ready" ? "text-ready" : phase === "holding" ? "text-holding" : "text-foreground";

  const best = bestSingle(solves);
  const recent = solves.slice(-RECENT_COUNT).reverse();

  // A near-miss or a beaten PB is the strongest reason to start another solve,
  // so the moment it happens has to be visible without being a party trick.
  const lastEffective = lastSolve ? effectiveMs(lastSolve) : null;
  const isPersonalBest = solves.length > 1 && lastEffective !== null && lastEffective === best;

  return (
    <main
      className="no-select relative flex min-h-dvh flex-col"
      style={{ touchAction: "manipulation" }}
      {...touchHandlers}
    >
      <SiteHeader active="timer" fade={chromeHidden} trailing="3×3" />
      {/* The page title, for assistive tech. This screen is deliberately
          chrome-free — a visible heading beside the clock would be noise. */}
      <h1 className="sr-only">Speedcubing timer</h1>

      {/*
        Scramble, clock and stats form one centred stack instead of three things
        pinned to separate edges. The eye travels scramble -> clock in a single
        short move, and the screen reads as one object rather than a dashboard.
      */}
      <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6 py-4 md:gap-8">
        <section className={`w-full text-center ${chromeClass}`}>
          {scrambleError ? (
            <p className="text-sm text-danger">
              Couldn&apos;t generate a scramble. Reload to try again.
            </p>
          ) : (
            /*
              An even gap per move, not letter-spacing across the whole string.
              Scrambles are read in chunks; stretched tracking destroys the chunking
              and is the single most common flaw in existing timers.
            */
            <div className="mx-auto flex min-h-14 max-w-5xl flex-wrap items-center justify-center gap-x-3 gap-y-1.5 font-mono text-lg leading-snug sm:text-xl md:text-2xl">
              {scramble
                ? scramble.split(" ").map((move, i) => <span key={`${move}-${i}`}>{move}</span>)
                : null}
            </div>
          )}
        </section>

        {/* Sized in vh so it yields to the clock on short laptop screens rather
            than pushing the stats off the bottom. */}
        <CubeView
          scramble={scramble}
          className={`h-[24vh] max-h-64 min-h-36 w-full max-w-lg ${chromeClass}`}
        />

        <div className="relative flex flex-col items-center">
          <div
            ref={displayRef as React.RefObject<HTMLDivElement>}
            className={`tnum text-7xl font-medium leading-none tracking-tighter transition-colors duration-100 sm:text-8xl md:text-9xl ${timeColor}`}
          >
            0.00
          </div>
          <span
            className={`pointer-events-none absolute -top-1 right-0 translate-x-[calc(100%+0.75rem)] text-[10px] font-semibold uppercase tracking-widest text-ready transition-opacity duration-200 ${
              isPersonalBest && !chromeHidden ? "opacity-100" : "opacity-0"
            }`}
          >
            PB
          </span>
        </div>

        {/*
          The one thing that stays on screen during a solve. Everything else fades
          because nothing should compete with the clock — but in split mode you have
          to know which phase your next tap ends, or the taps are meaningless.
        */}
        {splitMode ? (
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest">
            {SPLIT_LABELS.map((label, i) => {
              const done = phase === "running" && i < splitIndex;
              const current = phase === "running" && i === splitIndex;
              return (
                <span
                  key={label}
                  className={
                    current
                      ? "text-ready"
                      : done
                        ? "text-muted-dim line-through"
                        : "text-muted-dim"
                  }
                >
                  {label}
                </span>
              );
            })}
          </div>
        ) : null}

        {review ? (
          <div className={chromeClass}>
            <SolveReviewPanel
              review={review}
              /* No /drill route yet: the case coach on /progress is the nearest real
                 destination, and it links straight into practising the case. */
              drillHref="/progress"
              onAgain={nextRound}
            />
          </div>
        ) : null}

        <div className={`flex items-center gap-8 text-center ${chromeClass}`}>
          <Stat label="ao5" value={formatAverage(ao5(solves))} />
          <Stat label="ao12" value={formatAverage(ao12(solves))} />
          <Stat label="best" value={best === null ? "—" : formatMs(best)} />
          <Stat label="solves" value={String(solves.length)} />
        </div>

        <div className={`flex h-9 items-center gap-2 ${chromeClass}`}>
          {lastSolve ? (
            <>
              <PenaltyButton
                label="+2"
                active={lastSolve.penalty === "PLUS2"}
                onClick={() => setPenalty("PLUS2")}
              />
              <PenaltyButton
                label="DNF"
                active={lastSolve.penalty === "DNF"}
                onClick={() => setPenalty("DNF")}
              />
              <PenaltyButton label="delete" active={false} onClick={deleteLast} />
            </>
          ) : null}
        </div>

        {/*
          A stopwatch cannot see turns, so phase analysis is otherwise locked to
          people with a smart cube or a keyboard. Four taps is coarser data and it
          works with the cube already in your hands — which is the difference between
          the analysis being available to everyone and to almost nobody.
        */}
        <button
          type="button"
          onClick={(event) => {
            event.currentTarget.blur();
            toggleSplitMode();
          }}
          className={`rounded-md border px-3 py-1.5 text-xs transition-colors ${chromeClass} ${
            splitMode
              ? "border-ready/40 bg-ready/10 text-ready"
              : "border-border text-muted-dim hover:border-muted-dim hover:text-muted"
          }`}
        >
          {splitMode ? "Splits on — space ends each phase" : "Record phase splits"}
        </button>
      </div>

      <footer className={`px-6 pb-6 ${chromeClass}`}>
        <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-center gap-x-2 gap-y-2">
          {recent.length === 0 ? (
            <p className="text-xs text-muted-dim">
              Hold space — or press and hold anywhere — until it turns green, then release.
            </p>
          ) : (
            recent.map((solve) => {
              const eff = effectiveMs(solve);
              const isBest = eff !== null && eff === best;
              return (
                <span
                  key={solve.id}
                  title={solve.scramble}
                  className={`tnum rounded-md px-2 py-1 text-xs transition-colors ${
                    solve.penalty === "DNF"
                      ? "text-danger"
                      : isBest
                        ? "bg-surface-hi text-foreground"
                        : "text-muted"
                  }`}
                >
                  {formatSolve(solve)}
                </span>
              );
            })
          )}
        </div>
      </footer>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <span className="text-[10px] uppercase tracking-widest text-muted-dim">{label}</span>
      <span className="tnum text-lg font-medium text-muted">{value}</span>
    </div>
  );
}

function PenaltyButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      /*
       * Blur after activating. Space no longer arms the timer while a control has
       * focus — correct — but the browser then routes space to the focused button
       * instead, so a space press after clicking "delete" deleted another solve with
       * nothing on screen saying so. Releasing focus hands the spacebar back to the
       * timer, which is where a cuber expects it.
       */
      onClick={(event) => {
        event.currentTarget.blur();
        onClick();
      }}
      className={`rounded-md border px-3 py-1.5 text-xs transition-colors ${
        active
          ? "border-danger/40 bg-danger/10 text-danger"
          : "border-border text-muted-dim hover:border-muted-dim hover:text-muted"
      }`}
    >
      {label}
    </button>
  );
}
