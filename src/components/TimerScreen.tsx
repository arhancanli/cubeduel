"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { CubeView } from "@/components/CubeView";
import type { PhaseSplit } from "@/lib/cfop";
import { SiteHeader } from "@/components/SiteHeader";
import { SolveSwitch } from "@/components/SolveSwitch";
import { FirstVisit } from "@/components/FirstVisit";
import { SolveReviewPanel } from "@/components/SolveReview";
import { formatAverage, formatMs, formatSolve } from "@/lib/format";
import { nextScramble, warmScrambles } from "@/lib/scramble";
import { ao5, ao12, ao50, ao100, bestSingle, effectiveMs, sessionMean } from "@/lib/stats";
import { SessionChart } from "@/components/SessionChart";
import { loadHistory, recordSolve, removeSolve, updateSolvePenalty } from "@/lib/solveHistory";
import { reviewSolve, type SolveReview } from "@/lib/solveReview";
import { loadState, newSolve, saveState, type PersistedState } from "@/lib/storage";
import type { Penalty, Solve } from "@/lib/types";
import { useSpeedTimer } from "@/lib/useSpeedTimer";
import { useLatest } from "@/lib/useLatest";
import { MilestoneMoment } from "@/components/MilestoneMoment";
import type { EventId } from "@/lib/events";
import { hasTimerReview, isMisfire, sessionFor, splitLabelsFor, TIMER_EVENTS } from "@/lib/timerEvents";

const RECENT_COUNT = 12;

/** CFOP stages, in order. These names match what the analyser groups on. */
const SPLIT_MODE_KEY = "cubeduel.splitMode.v1";

/**
 * Turns cumulative lap times into phase splits.
 *
 * Move counts are left at zero and reported as unknown rather than guessed — a
 * stopwatch genuinely cannot see turns, and inventing a number here would put a
 * fabricated TPS next to a measured time.
 */
function buildSplits(laps: number[], labels: readonly string[]): PhaseSplit[] {
  const splits: PhaseSplit[] = [];
  let prev = 0;
  labels.forEach((label, i) => {
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
  // The last stop that was too fast to be a solve, shown so a mis-tap is
  // explained rather than silently swallowed. Null once a real solve lands.
  const [misfireMs, setMisfireMs] = useState<number | null>(null);
  // The solve finished on this page, so only a solve done now is celebrated —
  // not the last one of a session reopened tomorrow.
  const [momentId, setMomentId] = useState<string | null>(null);

  // The scramble that was on screen when the timer started — the one the solve is
  // actually for. Held in a ref so prefetching the next one can't swap it mid-solve.
  const activeScrambleRef = useRef("");

  const session = state ? state.sessions.find((s) => s.id === state.activeSessionId) : undefined;
  const solves = useMemo(() => session?.solves ?? [], [session]);
  // The puzzle is the session's: each puzzle keeps its own session, so an
  // average never mixes a 3x3 with a 5x5.
  const event: EventId = TIMER_EVENTS.some((e) => e.id === session?.event)
    ? (session!.event as EventId)
    : "333";
  const eventRef = useLatest(event);
  const puzzle = TIMER_EVENTS.find((e) => e.id === event)!.puzzle;

  const nextRound = useCallback(() => {
    setReview(null);
  }, []);

  const advanceScramble = useCallback(async () => {
    const wanted = eventRef.current;
    try {
      const next = await nextScramble(wanted);
      // Switched puzzle while this one was being generated: a 3x3 scramble
      // must never land on the 5x5 timer.
      if (eventRef.current !== wanted) return;
      setScramble(next);
      setScrambleError(false);
    } catch {
      if (eventRef.current === wanted) setScrambleError(true);
    }
  }, [eventRef]);

  useEffect(() => {
    setState(loadState());
    try {
      setSplitMode(window.localStorage.getItem(SPLIT_MODE_KEY) === "1");
    } catch {
      /* Private mode — the default is fine. */
    }
  }, []);

  // A new scramble whenever the puzzle changes — including the first time the
  // stored session is read, which may not be a 3x3.
  const loaded = state !== null;
  useEffect(() => {
    if (!loaded) return;
    setReview(null);
    setScramble("");
    warmScrambles(event);
    void advanceScramble();
  }, [event, loaded, advanceScramble]);

  const chooseEvent = useCallback((next: EventId) => {
    setState((current) => {
      if (!current) return current;
      const moved = sessionFor(current, next);
      if (moved !== current) saveState(moved);
      return moved;
    });
  }, []);

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
      const event = eventRef.current;
      // A thumb on the spacebar, not a solve: not saved, and the scramble is
      // kept, since the cube in their hands still has it on.
      if (isMisfire(ms, event)) {
        setMisfireMs(ms);
        setReview(null);
        return;
      }
      setMisfireMs(null);
      const splits = laps.length > 0 ? buildSplits(laps, splitLabelsFor(event)) : [];
      // Reviewed against history as it stood *before* this solve — a par that this
      // solve helped set would flatten its own gap toward zero. The quick panel
      // reads CFOP phases, so it is a 3x3's; other puzzles get the full review.
      setReview(event === "333" ? reviewSolve(splits, ms, loadHistory("333")) : null);

      const solved = newSolve(ms, activeScrambleRef.current, event);
      // The next scramble is issued immediately even though the review is on screen.
      // A cuber doing fifty solves in a session holds space again without looking, and
      // making them dismiss a panel first would tax the loop far more than the review
      // is worth. "Again" then only has to clear the panel.
      void advanceScrambleRef.current();
      mutateSolves((list) => [...list, solved]);
      setMomentId(solved.id);
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
        // A real cube and a key press: a time, and no turns behind it.
        source: "manual",
        event,
      });
    },
    [mutateSolves, advanceScrambleRef, eventRef],
  );

  const eventSplits = splitLabelsFor(event);
  const splitLabels = useMemo(() => (splitMode ? eventSplits : []), [splitMode, eventSplits]);

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
      <SiteHeader active="timer" fade={chromeHidden} />
      {/* The page title, for assistive tech. This screen is deliberately
          chrome-free — a visible heading beside the clock would be noise. */}
      <h1 className="sr-only">Speedcubing timer</h1>

      {/*
        Two columns on a wide screen, like every serious timer: the solve on the
        left — how you solve, the scramble, the cube, the clock — and your session
        on the right. On a phone the session drops below. Everything but the clock
        fades while a solve is running.
      */}
      <div className="mx-auto grid w-full max-w-7xl flex-1 items-start gap-6 px-4 pb-10 pt-3 sm:px-8 lg:grid-cols-[minmax(0,1fr)_19rem] lg:gap-8 lg:pt-8">
        <div className="flex min-w-0 flex-col items-center gap-5 md:gap-6">
          <FirstVisit hasSolves={solves.length > 0} />
          <SolveSwitch active="timer" className={chromeClass} />

          <section className={`w-full rounded-2xl border border-border bg-surface px-4 py-4 sm:px-6 ${chromeClass}`}>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
              {/* Which puzzle. Each keeps its own session, so switching never
                  mixes a 3x3 average with a 5x5 one. */}
              <div role="radiogroup" aria-label="Puzzle" className="flex gap-1 rounded-lg bg-surface-hi p-0.5">
                {TIMER_EVENTS.map((e) => (
                  <button
                    key={e.id}
                    type="button"
                    role="radio"
                    aria-checked={e.id === event}
                    onClick={(click) => {
                      // Focus would take the spacebar away from the timer.
                      click.currentTarget.blur();
                      chooseEvent(e.id);
                    }}
                    className={`rounded-md px-2.5 py-1 text-xs font-semibold tabular-nums transition-colors ${
                      e.id === event ? "bg-background text-foreground" : "text-muted-dim hover:text-foreground"
                    }`}
                  >
                    {e.label}
                  </button>
                ))}
              </div>
              <span className="text-[11px] text-muted-dim">Hold it with white on top, green in front</span>
            </div>
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
              <div
                className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 font-mono leading-snug ${
                  event === "555"
                    ? "min-h-40 text-sm sm:text-base lg:min-h-24"
                    : event === "444"
                      ? "min-h-28 text-base sm:text-lg lg:min-h-16"
                      : // Three lines held on a phone: before the monospace font
                        // arrives, its wider fallback wraps a 3x3 scramble to three,
                        // and the clock jumped as the real font swapped in.
                        "min-h-[5.4rem] text-lg sm:min-h-[4.25rem] sm:text-xl md:text-2xl lg:min-h-[4.5rem]"
                }`}
              >
                {scramble
                  ? scramble.split(" ").map((move, i) => <span key={`${move}-${i}`}>{move}</span>)
                  : null}
              </div>
            )}
          </section>

          {/* One cube. Two side by side — front and back — read as two
              puzzles to anybody new. Sized in vh so it yields to the clock on
              short laptop screens. */}
          <CubeView
            scramble={scramble}
            puzzle={puzzle}
            backView="none"
            className={`h-[26vh] max-h-72 min-h-40 w-full max-w-md ${chromeClass}`}
          />

          <div className="relative flex flex-col items-center">
            <div
              ref={displayRef as React.RefObject<HTMLDivElement>}
              className={`tnum font-display text-7xl font-bold leading-none tracking-tighter transition-colors duration-100 sm:text-8xl md:text-9xl ${timeColor}`}
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

          {/* Right under the time, where the eyes already are — below the
              review it sat under the fold on a laptop. */}
          {lastSolve && lastSolve.id === momentId ? (
            <div className={`flex w-full justify-center ${chromeClass}`}>
              <MilestoneMoment solveId={lastSolve.id} penalty={lastSolve.penalty} />
            </div>
          ) : null}

          <p className={`text-center text-sm text-muted ${chromeClass}`} data-testid="timer-hint">
            {misfireMs !== null && (phase === "idle" || phase === "stopped")
              ? `${formatMs(misfireMs, { truncate: false })} is too quick to be a solve, so it wasn't saved. Same scramble — go again.`
              : phase === "holding"
              ? "Keep holding…"
              : phase === "ready"
                ? "Release to start"
                : "Hold space — or press and hold anywhere — until the clock turns green, then let go."}
          </p>

          {/*
            The one thing that stays on screen during a solve. Everything else fades
            because nothing should compete with the clock — but in split mode you have
            to know which phase your next tap ends, or the taps are meaningless.
          */}
          {splitMode && eventSplits.length > 0 ? (
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest">
              {eventSplits.map((label, i) => {
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

          <div className={`flex min-h-9 flex-wrap items-center justify-center gap-2 ${chromeClass}`}>
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
                {lastSolve.penalty !== "DNF" && hasTimerReview(event) ? (
                  <Link
                    href={`/review?id=${encodeURIComponent(lastSolve.id)}`}
                    className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-muted transition-colors hover:border-muted-dim hover:text-foreground"
                  >
                    review →
                  </Link>
                ) : null}
              </>
            ) : null}
            {/*
              A stopwatch cannot see turns, so phase analysis is otherwise locked to
              people with a smart cube or a keyboard. Four taps is coarser data and it
              works with the cube already in your hands.
            */}
            {eventSplits.length > 0 ? (
            <button
              type="button"
              onClick={(click) => {
                click.currentTarget.blur();
                toggleSplitMode();
              }}
              title={`Tap space at the end of each phase — ${eventSplits.join(", ")} — so the site can tell you which part of your solve is slow.`}
              className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
                splitMode
                  ? "border-ready/40 bg-ready/10 text-ready"
                  : "border-border text-muted hover:border-muted-dim hover:text-foreground"
              }`}
            >
              {splitMode ? "Phase splits on — space ends each phase" : "Record phase splits"}
            </button>
            ) : null}
          </div>
        </div>

        {/* The session. */}
        <aside className={`flex flex-col gap-4 lg:sticky lg:top-6 ${chromeClass}`} aria-label="This session">
          <div className="grid grid-cols-2 gap-2">
            <Stat label="ao5" value={formatAverage(ao5(solves))} />
            <Stat label="ao12" value={formatAverage(ao12(solves))} />
            <Stat label="best" value={best === null ? "—" : formatMs(best)} />
            <Stat label="solves" value={String(solves.length)} />
          </div>
          {/* The longer view serious sessions are judged by: trimmed 5% from each
              end, as csTimer does, so the numbers agree with other timers. */}
          <div className="grid grid-cols-3 gap-2" data-testid="long-averages">
            <SmallStat label="ao50" value={formatAverage(ao50(solves))} />
            <SmallStat label="ao100" value={formatAverage(ao100(solves))} />
            <SmallStat label="mean" value={formatAverage(sessionMean(solves))} />
          </div>
          <SessionChart solves={solves} />

          <section className="flex flex-col overflow-hidden rounded-2xl border border-border bg-surface">
            <h2 className="border-b border-border px-4 py-3 text-sm">Recent solves</h2>
            {recent.length === 0 ? (
              <p className="px-4 py-5 text-sm leading-relaxed text-muted-dim">
                Your times appear here. Everything stays on this device unless you sign in.
              </p>
            ) : (
              <ol data-testid="recent-solves" className="flex max-h-[22rem] flex-col divide-y divide-border overflow-y-auto">
                {recent.map((solve, i) => {
                  const eff = effectiveMs(solve);
                  const isBest = eff !== null && eff === best;
                  return (
                    <li key={solve.id} className="flex items-center gap-3 px-4 py-2" data-testid="recent-solve">
                      <span className="tnum w-6 shrink-0 text-xs text-muted-dim">{solves.length - i}</span>
                      <span
                        data-testid="recent-time"
                        title={solve.scramble}
                        className={`tnum flex-1 font-display text-base font-bold ${
                          solve.penalty === "DNF" ? "text-danger" : isBest ? "text-ready" : "text-foreground"
                        }`}
                      >
                        {formatSolve(solve)}
                      </span>
                      {isBest ? (
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-ready">best</span>
                      ) : null}
                    </li>
                  );
                })}
              </ol>
            )}
            <Link
              href="/progress"
              className="border-t border-border px-4 py-3 text-sm font-semibold text-muted transition-colors hover:text-foreground"
            >
              Where your time goes →
            </Link>
          </section>
        </aside>
      </div>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-border bg-surface px-4 py-3">
      <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-dim">{label}</span>
      <span className="tnum font-display text-2xl font-bold">{value}</span>
    </div>
  );
}

function SmallStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-xl border border-border bg-surface px-3 py-2">
      <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-dim">{label}</span>
      <span className="tnum text-sm font-semibold">{value}</span>
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
