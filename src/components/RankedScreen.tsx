"use client";

import { useCallback, useRef, useState } from "react";


import { CubeView } from "@/components/CubeView";
import { InspectionCountdown } from "@/components/InspectionCountdown";
import { KeyMapHint } from "@/components/KeyMapHint";
import { MovePad } from "@/components/MovePad";
import { SiteHeader } from "@/components/SiteHeader";
import { formatMs } from "@/lib/format";
import { INSPECTION_LIMIT_MS } from "@/lib/inspection";
import { DEFAULT_EVENT, EVENTS, EVENT_IDS, type EventId } from "@/lib/events";
import { ESTABLISHED_DEVIATION, WINDOW_SIZE, msForRating } from "@/lib/rating";
import { useLatest } from "@/lib/useLatest";
import { track } from "@/lib/analytics";
import { useSolveSession } from "@/lib/useSolveSession";

/**
 * Ranked.
 *
 * The difference from practice is not the cube — it is where the scramble comes
 * from and what happens to the result. The server issues a scramble nobody has
 * seen, replays the submitted moves against that exact scramble, and only then
 * does anything count.
 *
 * The screen's real job is telling the truth about that plainly, because a ladder
 * whose rules are hidden feels arbitrary the first time it takes something away.
 * Two rules get stated up front rather than discovered:
 *
 *   - Every fifth attempt moves the rating, as a WCA ao5.
 *   - Leaving an attempt unfinished records a DNF.
 *
 * The second is the one people are owed a warning about, so it is on screen
 * before the first turn rather than in a help page nobody opens.
 */

export type RankedStanding = RankedRating;

export interface RankedRating {
  rating: number | null;
  deviation: number;
  peak: number | null;
  established: boolean;
  pendingAttempts: number;
}

interface AttemptResponse {
  attemptId: string;
  scramble: string;
  expiresAt: string;
}

interface SubmitResponse {
  accepted?: boolean;
  reason?: string;
  penalty?: "OK" | "PLUS2" | "DNF";
  inspectionMs?: number;
  inspectionReason?: string;
  attemptsUntilRating?: number;
  rating?: {
    before: number | null;
    after: number | null;
    deviation: number;
    averageMs: number | null;
    failed: boolean;
    established: boolean;
  } | null;
}

export function RankedScreen({
  standings,
}: {
  standings: Record<EventId, RankedStanding>;
}) {
  const attemptIdRef = useRef<string | null>(null);
  const submittedRef = useRef(false);

  /**
   * The event being played.
   *
   * Each event is a separate ladder with its own rating, because they are
   * separate skills — a world-class 3x3 solver can be a beginner on 5x5, and a
   * single number covering both would describe neither.
   */
  const [event, setEvent] = useState<EventId>(DEFAULT_EVENT);
  const eventRef = useLatest(event);

  const [ratings, setRatings] = useState(standings);
  const rating = ratings[event];
  const setRating = useCallback(
    (next: RankedRating | ((prev: RankedRating) => RankedRating)) => {
      setRatings((all) => {
        const key: EventId = eventRef.current;
        const current = all[key];
        const value = typeof next === "function" ? next(current) : next;
        return { ...all, [key]: value };
      });
    },
    [eventRef],
  );
  const [status, setStatus] = useState<string | null>(null);
  const [rejection, setRejection] = useState<string | null>(null);
  const [lastWindow, setLastWindow] = useState<SubmitResponse["rating"]>(null);
  const [submitting, setSubmitting] = useState(false);
  /** False until the player opens their first attempt of this visit. */
  const [started, setStarted] = useState(false);
  const [verdict, setVerdict] = useState<string | null>(null);

  /** Ask the server for a scramble. This is the whole point of ranked. */
  const supplyScramble = useCallback(async () => {
    setStarted(true);
    setRejection(null);
    setStatus(null);
    setVerdict(null);
    submittedRef.current = false;
    attemptIdRef.current = null;

    const response = await fetch("/api/ranked/attempt", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ event: eventRef.current, source: "keyboard" }),
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      throw new Error(body?.error ?? "Could not start a ranked attempt.");
    }

    const attempt = (await response.json()) as AttemptResponse;
    attemptIdRef.current = attempt.attemptId;

    // Recorded on the ISSUE, not on the submit. This is the moment somebody
    // chooses to play for the record, and the gap between issuing and
    // submitting is itself the interesting number — an attempt that is never
    // submitted is somebody who looked at a scramble and walked away.
    track("ranked_attempt", { event: eventRef.current });
    // Inspection starts the moment the scramble lands, because that is the
    // moment the player is allowed to look at it — the same instant the server
    // began counting when it sent this. The countdown itself keys off the
    // session phase, so nothing has to be started here.
    return attempt.scramble;
    // The ref object is stable for the life of the component, so listing it
    // changes nothing at runtime — it only tells the rule what it cannot see
    // through a custom hook.
  }, [eventRef]);

  const session = useSolveSession({
    nextScramble: supplyScramble,
    // Nothing is requested until the player asks for it. Opening an attempt is
    // a commitment — walking away from it is a DNF — so it cannot happen just
    // because somebody looked at the page.
    autoStart: false,
    onRoundError: (message) => setRejection(message),
    onSolved: ({ recording, analysis, source }) => {
      const attemptId = attemptIdRef.current;
      // Guard against a double submit: the recorder fires once, but a retry or a
      // second tab must not be able to spend the same attempt twice.
      if (!attemptId || submittedRef.current) return;
      submittedRef.current = true;
      setSubmitting(true);

      void fetch("/api/ranked/submit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          attemptId,
          clientId: `rk_${attemptId}`,
          durationMs: recording.durationMs,
          penalty: "OK",
          source,
          moves: recording.moves.map((m) => ({ move: m.move, atMs: m.atMs })),
          splits: analysis.splits,
          ollCase: analysis.ollCase,
          pllCase: analysis.pllCase,
        }),
      })
        .then(async (response) => {
          const body = (await response.json().catch(() => null)) as SubmitResponse | null;

          if (!response.ok || !body?.accepted) {
            setRejection(body?.reason ?? "That solve could not be verified.");
            return;
          }

          setVerdict(body.inspectionReason || null);
          const remaining = body.attemptsUntilRating ?? WINDOW_SIZE;
          setRating((current) => ({
            ...current,
            pendingAttempts: WINDOW_SIZE - remaining,
          }));

          if (body.rating) {
            setLastWindow(body.rating);
            setRating((current) => ({
              ...current,
              rating: body.rating!.after,
              deviation: body.rating!.deviation,
              established: body.rating!.established,
              peak:
                body.rating!.after !== null &&
                body.rating!.established &&
                (current.peak === null || body.rating!.after > current.peak)
                  ? body.rating!.after
                  : current.peak,
              pendingAttempts: 0,
            }));
          } else {
            setLastWindow(null);
            setStatus(
              remaining === 1
                ? "One more attempt and your rating updates."
                : `${remaining} more attempts and your rating updates.`,
            );
          }
        })
        .catch(() => setRejection("Could not reach the server. That solve was not counted."))
        .finally(() => setSubmitting(false));
    },
  });

  const { scramble, phase, moveCount, splits, connectError, activeKey, displayRef } =
    session;
  const solving = phase === "running";

  return (
    <main className="flex min-h-dvh flex-col">
      <SiteHeader active="ranked" />

      <div className="flex flex-1 flex-col items-center gap-6 px-6 pb-10">
        <div className={solving ? "opacity-0" : "opacity-100 transition-opacity"}>
          <EventPicker
            selected={event}
            standings={ratings}
            // Locked once an attempt is open. Switching mid-attempt would leave
            // the open scramble belonging to one ladder and the next submission
            // to another, and the abandoned one is recorded as a DNF — so the
            // control would quietly cost a rating on a ladder the player had
            // just navigated away from.
            disabled={phase !== "idle" || started}
            onSelect={setEvent}
          />
          <RatingBar rating={rating} event={event} />
        </div>

        <div
          className={`flex w-full flex-col items-center gap-6 transition-opacity duration-200 ${
            solving ? "opacity-30" : "opacity-100"
          }`}
        >
          <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-center gap-x-3 gap-y-1.5 font-mono text-base leading-snug sm:text-lg">
            {scramble
              ? scramble.split(" ").map((move, i) => <span key={`${move}-${i}`}>{move}</span>)
              : null}
          </div>
        </div>

        <CubeView
          scramble={scramble}
          interactive
          onPlayerReady={session.onPlayerReady}
          className="h-[26vh] max-h-64 min-h-36 w-full max-w-lg"
        />

        <div className="flex flex-col items-center gap-2">
          <div
            ref={displayRef}
            className={`tnum text-6xl font-medium leading-none tracking-tighter transition-colors sm:text-7xl ${
              phase === "solved" ? "text-ready" : "text-foreground"
            }`}
          >
            0.00
          </div>
          <InspectionCountdown active={phase === "armed"} />
          <p className="text-xs text-muted-dim">
            {phase === "armed" && "Ranked attempt live — the first turn starts the clock."}
            {phase === "running" && `${moveCount} moves`}
            {phase === "solved" && (submitting ? "Verifying…" : "Solved")}
            {phase === "idle" &&
              (started ? "Getting a scramble…" : "Nothing is counted until you start.")}
          </p>
        </div>

        {lastWindow ? <WindowResult result={lastWindow} /> : null}
        {status && !lastWindow ? (
          <p className="text-sm text-muted">{status}</p>
        ) : null}

        {verdict ? (
          <p className="max-w-md rounded-lg border border-holding/40 bg-holding/5 px-4 py-3 text-center text-xs leading-relaxed text-holding">
            {verdict}
          </p>
        ) : null}

        {rejection ? (
          <p className="max-w-md rounded-lg border border-danger/40 bg-danger/5 px-4 py-3 text-center text-xs leading-relaxed text-danger">
            {rejection}
          </p>
        ) : null}

        {splits && splits.length > 0 ? (
          <p className="text-xs text-muted-dim">
            Splits recorded — see them on your profile.
          </p>
        ) : null}

        <div className="flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => void session.startRound()}
            disabled={submitting}
            className="rounded-lg bg-foreground px-5 py-2.5 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {!started
              ? "Start a ranked attempt"
              : phase === "solved"
                ? "Next attempt"
                : "New attempt"}
          </button>
        </div>

        {connectError ? (
          <p className="max-w-md text-center text-xs text-danger">{connectError}</p>
        ) : null}

        <p className="max-w-md text-center text-xs leading-relaxed text-muted-dim">
          Your rating moves every {WINDOW_SIZE} attempts, as a WCA average of 5.
          Starting a new attempt before finishing this one records the current one
          as a DNF. Inspection is WCA: {INSPECTION_LIMIT_MS / 1000} seconds from
          the moment the scramble appears, then +2, then a DNF past 17.
          It is timed by the server, not your browser.
        </p>

        <MovePad onMove={session.pushMove} className="md:hidden" />

        <div
          className={`mt-2 hidden transition-opacity duration-200 md:block ${
            solving ? "opacity-20" : "opacity-100"
          }`}
        >
          <KeyMapHint activeCode={activeKey} />
        </div>
      </div>
    </main>
  );
}

/**
 * The rating, and what it means in seconds.
 *
 * Showing both is the whole reason the scale is a clean invertible transform. A
 * bare number would be one more opaque score; "1738 · sub-20 pace" is a number
 * that teaches its own units.
 */
function RatingBar({ rating, event }: { rating: RankedRating; event: EventId }) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-3">
      <div className="flex flex-col items-center gap-1">
        <span className="text-[10px] uppercase tracking-widest text-muted-dim">
          rating
        </span>
        <span className="tnum text-2xl font-medium">
          {rating.rating === null ? "—" : Math.round(rating.rating)}
        </span>
        <span className="text-[11px] text-muted-dim">
          {rating.rating === null
            ? "unrated"
            : `${formatMs(msForRating(rating.rating, event), { truncate: false })} pace`}
        </span>
      </div>

      <div className="flex flex-col items-center gap-1">
        <span className="text-[10px] uppercase tracking-widest text-muted-dim">
          confidence
        </span>
        <span className="tnum text-2xl font-medium text-muted">
          ±{Math.round(rating.deviation)}
        </span>
        <span className="text-[11px] text-muted-dim">
          {rating.established
            ? "ranked"
            : `unranked until ±${ESTABLISHED_DEVIATION}`}
        </span>
      </div>

      <div className="flex flex-col items-center gap-1">
        <span className="text-[10px] uppercase tracking-widest text-muted-dim">
          next update
        </span>
        <span className="tnum text-2xl font-medium text-muted">
          {rating.pendingAttempts}/{WINDOW_SIZE}
        </span>
        <span className="text-[11px] text-muted-dim">attempts gathered</span>
      </div>
    </div>
  );
}

/** What a closed window did to the rating, including when it did nothing. */
function WindowResult({
  result,
}: {
  result: NonNullable<SubmitResponse["rating"]>;
}) {
  if (result.failed) {
    return (
      <div className="flex max-w-md flex-col items-center gap-2 rounded-lg border border-border bg-surface px-5 py-4 text-center">
        <p className="text-sm text-muted">That average was a DNF.</p>
        <p className="text-xs leading-relaxed text-muted-dim">
          Your rating is unchanged — a failed average says nothing about how fast
          you are, so nothing is invented. It does cost confidence, so your ± went
          up to {Math.round(result.deviation)}.
        </p>
      </div>
    );
  }

  const delta =
    result.before !== null && result.after !== null
      ? result.after - result.before
      : null;

  return (
    <div className="flex max-w-md flex-col items-center gap-2 rounded-lg border border-border bg-surface px-5 py-4 text-center">
      <p className="text-sm">
        <span className="text-muted">Average of 5: </span>
        <span className="tnum font-medium">
          {result.averageMs === null
            ? "—"
            : formatMs(result.averageMs, { truncate: false })}
        </span>
      </p>
      <p className="tnum text-2xl font-medium">
        {result.after === null ? "—" : Math.round(result.after)}
        {delta !== null && Math.round(delta) !== 0 ? (
          <span
            className={`ml-2 text-base ${delta > 0 ? "text-ready" : "text-danger"}`}
          >
            {delta > 0 ? "+" : ""}
            {Math.round(delta)}
          </span>
        ) : null}
      </p>
      <p className="text-xs text-muted-dim">
        {result.established
          ? "Ranked — you appear on the leaderboard."
          : `Provisional — ±${Math.round(result.deviation)}, still settling.`}
      </p>
    </div>
  );
}

/**
 * Which puzzle you are laddering on.
 *
 * Each event is a separate rating because they are separate skills: a
 * world-class 3x3 solver can be a beginner on 5x5, and one number covering both
 * would describe neither. The rating still means the same thing on each —
 * 3000 is world class, 2000 is a strong club cuber — which is what makes the
 * numbers comparable even though the times are not.
 */
function EventPicker({
  selected,
  standings,
  disabled,
  onSelect,
}: {
  selected: EventId;
  standings: Record<EventId, RankedStanding>;
  disabled: boolean;
  onSelect: (event: EventId) => void;
}) {
  return (
    <div className="mb-4 flex justify-center gap-1" role="group" aria-label="Event">
      {EVENT_IDS.map((id) => {
        const standing = standings[id];
        const active = id === selected;
        return (
          <button
            key={id}
            type="button"
            disabled={disabled}
            aria-pressed={active}
            onClick={() => onSelect(id)}
            title={
              standing.rating === null
                ? `${EVENTS[id].longName} — unrated`
                : `${EVENTS[id].longName} — ${Math.round(standing.rating)}`
            }
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-40 ${
              active
                ? "bg-surface-hi text-foreground"
                : "text-muted-dim hover:text-muted"
            }`}
          >
            {EVENTS[id].name}
            {/* The rating, small, so switching is an informed choice rather
                than a guess about where you left off. */}
            {standing.rating !== null ? (
              <span className="tnum ml-1.5 opacity-60">{Math.round(standing.rating)}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
