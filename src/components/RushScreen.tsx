"use client";

import Link from "next/link";
import { useCallback, useRef, useState } from "react";

import { CubeView } from "@/components/CubeView";
import { KeyMapHint } from "@/components/KeyMapHint";
import { MovePad } from "@/components/MovePad";
import { SiteHeader } from "@/components/SiteHeader";
import { DEFAULT_EVENT, EVENTS, EVENT_IDS, type EventId } from "@/lib/events";
import { formatMs } from "@/lib/format";
import { RUSH_LIVES, type RushState } from "@/lib/rush";
import { useLatest } from "@/lib/useLatest";
import { track } from "@/lib/analytics";
import { useSolveSession } from "@/lib/useSolveSession";

/**
 * Rush.
 *
 * The pressure is the feature. Everything else on this site measures you after
 * the fact; here the target is on screen before you turn a face, and it gets
 * smaller every time you beat it. That is the situation a competition round
 * actually is, and it is the one thing a timer can never reproduce.
 *
 * There is no inspection countdown, deliberately. Rush is not a WCA round and
 * pretending otherwise would be the wrong kind of faithful — the clock the
 * player is fighting is the target, and a second clock beside it splits the
 * attention the mode exists to concentrate.
 */

interface StartResponse {
  runId: string;
  scramble: string;
  targetMs: number;
  paceMs: number;
  state: RushState;
}

interface SubmitResponse {
  accepted?: boolean;
  reason?: string;
  cleared?: boolean;
  targetMs?: number;
  effectiveMs?: number | null;
  state?: RushState;
  scramble?: string | null;
  nextTargetMs?: number | null;
}

interface Outcome {
  cleared: boolean;
  effectiveMs: number | null;
  targetMs: number;
}

export function RushScreen({
  bests,
}: {
  bests: Record<EventId, { score: number; bestStreak: number } | null>;
}) {
  /**
   * The puzzle this run is on.
   *
   * Locked once a run is live: the run's targets were built from this event's
   * pace and its scrambles are for this puzzle, so switching mid-run would ask
   * somebody to solve a 4x4 against a 3x3 target.
   */
  const [event, setEvent] = useState<EventId>(DEFAULT_EVENT);
  const runIdRef = useRef<string | null>(null);
  const submittedRef = useRef(false);

  const [state, setState] = useState<RushState | null>(null);
  const [target, setTarget] = useState<number | null>(null);
  const [last, setLast] = useState<Outcome | null>(null);
  const [rejection, setRejection] = useState<string | null>(null);
  const [started, setStarted] = useState(false);
  /**
   * Whether the next scramble has arrived and is waiting.
   *
   * State rather than the ref that holds it, because the render needs to know:
   * reading a ref during render is what the compiler forbids, and it forbids it
   * for a real reason — a ref changing does not schedule a render, so a button
   * gated on one can simply fail to appear.
   */
  const [queued, setQueued] = useState(false);
  const [records, setRecords] = useState(bests);
  const record = records[event];
  const setRecord = useCallback(
    (next: (prev: { score: number; bestStreak: number } | null) => { score: number; bestStreak: number } | null) => {
      setRecords((all) => ({ ...all, [eventRef.current]: next(all[eventRef.current]) }));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // Held so the mount-stable callbacks below can read the current scramble
  // without being rebuilt, which would tear down the solve session mid-run.
  const pendingRef = useRef<string | null>(null);
  const eventRef = useLatest(event);

  /**
   * Supplies the next scramble.
   *
   * The first call opens the run; afterwards the scramble already arrived with
   * the previous submission, so this hands it straight over. One round trip per
   * solve, which in a mode measured in seconds is the difference between fluid
   * and stuttering.
   */
  const supplyScramble = useCallback(async () => {
    setRejection(null);
    submittedRef.current = false;

    const waiting = pendingRef.current;
    if (waiting) {
      pendingRef.current = null;
      setQueued(false);
      return waiting;
    }

    const response = await fetch("/api/rush/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ event: eventRef.current }),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new Error(body?.error ?? "Could not start a run.");
    }

    const run = (await response.json()) as StartResponse;
    runIdRef.current = run.runId;
    track("rush_start", { event: eventRef.current });
    setState(run.state);
    setTarget(run.targetMs);
    setLast(null);
    return run.scramble;
  }, [eventRef]);

  const session = useSolveSession({
    nextScramble: supplyScramble,
    // A run is a commitment. Nobody starts one by opening a page.
    autoStart: false,
    onRoundError: (message) => setRejection(message),
    onSolved: ({ recording, analysis, source }) => {
      const runId = runIdRef.current;
      if (!runId || submittedRef.current) return;
      submittedRef.current = true;

      void fetch("/api/rush/submit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          runId,
          clientId: `rush_${runId}_${Date.now()}`,
          durationMs: recording.durationMs,
          penalty: "OK",
          source,
          moves: recording.moves.map((m) => ({ move: m.move, atMs: m.atMs })),
          splits: analysis.splits,
        }),
      })
        .then(async (response) => {
          const body = (await response.json().catch(() => null)) as SubmitResponse | null;
          if (!body?.accepted || !body.state) {
            setRejection(body?.reason ?? "That solve could not be recorded.");
            return;
          }

          setState(body.state);
          setLast({
            cleared: Boolean(body.cleared),
            effectiveMs: body.effectiveMs ?? null,
            targetMs: body.targetMs ?? 0,
          });

          if (body.state.over) {
            setTarget(null);
            setRecord((r) =>
              !r || body.state!.score > r.score
                ? { score: body.state!.score, bestStreak: body.state!.bestStreak }
                : r,
            );
            return;
          }

          // Queued rather than applied: the next round starts when the player
          // asks for it, so they get a beat to see whether they cleared.
          pendingRef.current = body.scramble ?? null;
          setQueued(body.scramble !== null && body.scramble !== undefined);
          setTarget(body.nextTargetMs ?? null);
        })
        .catch(() => setRejection("Could not reach the server. That solve was not recorded."));
    },
  });

  const { scramble, phase, moveCount, connectError, activeKey, displayRef } = session;
  const solving = phase === "running";
  const over = state?.over ?? false;

  const begin = useCallback(() => {
    setStarted(true);
    pendingRef.current = null;
    setQueued(false);
    runIdRef.current = null;
    setState(null);
    setLast(null);
    void session.startRound();
  }, [session]);

  return (
    <main className="flex min-h-dvh flex-col">
      <SiteHeader active="rush" fade={solving} />

      <div className="flex flex-1 flex-col items-center gap-6 px-6 pb-12">
        {!started ? (
          <Intro
            event={event}
            best={record}
            bests={records}
            onSelect={setEvent}
            onStart={begin}
          />
        ) : (
          <>
            <Scoreboard state={state} target={target} solving={solving} />

            <div
              className={`mx-auto flex max-w-5xl flex-wrap items-center justify-center gap-x-3 gap-y-1.5 font-mono text-base leading-snug transition-opacity duration-200 sm:text-lg ${
                solving ? "opacity-30" : "opacity-100"
              }`}
            >
              {!over && scramble
                ? scramble.split(" ").map((move, i) => <span key={`${move}-${i}`}>{move}</span>)
                : null}
            </div>

            {!over ? (
              <CubeView
                scramble={scramble}
                interactive
                onPlayerReady={session.onPlayerReady}
                className="h-[24vh] max-h-56 min-h-32 w-full max-w-md"
              />
            ) : null}

            <div className="flex flex-col items-center gap-2">
              <div
                ref={displayRef}
                className={`tnum font-display text-6xl font-bold leading-none tracking-tighter transition-colors sm:text-7xl ${
                  last && phase === "solved"
                    ? last.cleared
                      ? "text-ready"
                      : "text-danger"
                    : "text-foreground"
                }`}
              >
                0.00
              </div>
              <p className="text-xs text-muted-dim">
                {phase === "armed" && !over && "First turn starts the clock."}
                {phase === "running" && `${moveCount} moves`}
                {phase === "solved" && !over && (last ? verdictLine(last) : "Checking…")}
                {phase === "idle" && !over && "Getting a scramble…"}
              </p>
            </div>

            {over ? (
              <Summary state={state} best={record} onAgain={begin} />
            ) : (
              <>
                {phase === "solved" && queued ? (
                  <button
                    type="button"
                    onClick={() => void session.startRound()}
                    autoFocus
                    className="btn-go px-6 py-2.5 text-sm"
                  >
                    Next scramble
                  </button>
                ) : null}
                <MovePad onMove={session.pushMove} className="md:hidden" />
              </>
            )}
          </>
        )}

        {rejection ? (
          <p className="max-w-md rounded-lg border border-danger/40 bg-danger/5 px-4 py-3 text-center text-xs leading-relaxed text-danger">
            {rejection}
          </p>
        ) : null}
        {connectError ? <p className="text-xs text-danger">{connectError}</p> : null}

        {!over ? (
          <div className="mt-2 hidden md:block">
            <KeyMapHint activeCode={activeKey} />
          </div>
        ) : null}
      </div>
    </main>
  );
}

function verdictLine(last: Outcome): string {
  if (last.effectiveMs === null) return "Did not solve";
  const margin = Math.abs(last.effectiveMs - last.targetMs);
  return last.cleared
    ? `Cleared by ${formatMs(margin, { truncate: false })}`
    : `Missed by ${formatMs(margin, { truncate: false })}`;
}

/** The target, the score, and the lives left — the only numbers that matter mid-run. */
function Scoreboard({
  state,
  target,
  solving,
}: {
  state: RushState | null;
  target: number | null;
  solving: boolean;
}) {
  return (
    <div
      className={`flex w-full max-w-md items-end justify-between transition-opacity ${
        solving ? "opacity-0" : "opacity-100"
      }`}
    >
      <div>
        <div className="text-[10px] uppercase tracking-widest text-muted-dim">Score</div>
        <div className="tnum text-3xl font-medium leading-none">{state?.score ?? 0}</div>
      </div>

      <div className="text-center">
        <div className="text-[10px] uppercase tracking-widest text-muted-dim">Beat this</div>
        <div className="tnum text-3xl font-medium leading-none text-ready">
          {target !== null ? formatMs(target, { truncate: false }) : "—"}
        </div>
      </div>

      <div className="text-right">
        <div className="text-[10px] uppercase tracking-widest text-muted-dim">Lives</div>
        <div className="flex items-center justify-end gap-1 pt-1.5">
          {Array.from({ length: RUSH_LIVES }, (_, i) => (
            <span
              key={i}
              aria-hidden="true"
              className={`h-2.5 w-2.5 rounded-full ${
                i < RUSH_LIVES - (state?.misses ?? 0) ? "bg-foreground" : "bg-surface-hi"
              }`}
            />
          ))}
          <span className="sr-only">
            {RUSH_LIVES - (state?.misses ?? 0)} of {RUSH_LIVES} remaining
          </span>
        </div>
      </div>
    </div>
  );
}

function Intro({
  event,
  best,
  bests,
  onSelect,
  onStart,
}: {
  event: EventId;
  best: { score: number; bestStreak: number } | null;
  bests: Record<EventId, { score: number; bestStreak: number } | null>;
  onSelect: (event: EventId) => void;
  onStart: () => void;
}) {
  return (
    <div className="flex max-w-md flex-col items-center gap-5 pt-10 text-center">
      <h1 className="text-3xl tracking-tight">Rush</h1>
      <p className="text-sm leading-relaxed text-muted">
        Solve under the target. Every time you beat it, it gets tighter. Three
        misses and the run is over.
      </p>
      <p className="text-xs leading-relaxed text-muted-dim">
        The target starts from your own {EVENTS[event].name} pace, so this is the
        same difficulty whether you average eight seconds or forty — it finds the
        edge of what you can do right now, which is the only place anybody
        improves.
      </p>

      <div className="flex justify-center gap-1" role="group" aria-label="Event">
        {EVENT_IDS.map((id) => (
          <button
            key={id}
            type="button"
            aria-pressed={id === event}
            onClick={() => onSelect(id)}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              id === event ? "bg-surface-hi text-foreground" : "text-muted-dim hover:text-muted"
            }`}
          >
            {EVENTS[id].name}
            {bests[id] ? (
              <span className="tnum ml-1.5 opacity-60">{bests[id]!.score}</span>
            ) : null}
          </button>
        ))}
      </div>

      {best ? (
        <p className="tnum text-xs text-muted">
          Your best: {best.score} solves · longest streak {best.bestStreak}
        </p>
      ) : null}

      <button
        type="button"
        onClick={onStart}
        className="btn-go px-7 py-3 text-sm"
      >
        Start a run
      </button>
    </div>
  );
}

function Summary({
  state,
  best,
  onAgain,
}: {
  state: RushState | null;
  best: { score: number; bestStreak: number } | null;
  onAgain: () => void;
}) {
  const isBest = state !== null && best !== null && state.score >= best.score;
  return (
    <div className="flex w-full max-w-md flex-col items-center gap-4 rounded-xl border border-border px-6 py-7 text-center">
      <p className="text-[10px] uppercase tracking-widest text-muted-dim">Run over</p>
      <p className="tnum text-5xl font-medium leading-none">{state?.score ?? 0}</p>
      <p className="text-sm text-muted">
        {state?.score === 1 ? "solve cleared" : "solves cleared"}
        {state && state.bestStreak > 0 ? ` · longest streak ${state.bestStreak}` : ""}
      </p>
      {isBest && (state?.score ?? 0) > 0 ? (
        <p className="text-xs text-ready">A personal best.</p>
      ) : null}

      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={onAgain}
          autoFocus
          className="btn-go px-6 py-2.5 text-sm"
        >
          Run it again
        </button>
        <Link
          href="/progress"
          className="rounded-lg border border-border px-4 py-2.5 text-xs text-muted transition-colors hover:border-muted-dim hover:text-foreground"
        >
          Your progress
        </Link>
      </div>
    </div>
  );
}
