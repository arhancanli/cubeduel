"use client";

import { useCallback, useRef, useState } from "react";

import { CubeView } from "@/components/CubeView";
import { KeyMapHint } from "@/components/KeyMapHint";
import { MovePad } from "@/components/MovePad";
import { SiteHeader } from "@/components/SiteHeader";
import { formatMs } from "@/lib/format";
import { ESTABLISHED_DEVIATION, WINDOW_SIZE, msForRating } from "@/lib/rating";
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

export function RankedScreen({ initial }: { initial: RankedRating }) {
  const attemptIdRef = useRef<string | null>(null);
  const submittedRef = useRef(false);

  const [rating, setRating] = useState<RankedRating>(initial);
  const [status, setStatus] = useState<string | null>(null);
  const [rejection, setRejection] = useState<string | null>(null);
  const [lastWindow, setLastWindow] = useState<SubmitResponse["rating"]>(null);
  const [submitting, setSubmitting] = useState(false);

  /** Ask the server for a scramble. This is the whole point of ranked. */
  const supplyScramble = useCallback(async () => {
    setRejection(null);
    setStatus(null);
    submittedRef.current = false;
    attemptIdRef.current = null;

    const response = await fetch("/api/ranked/attempt", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ event: "333", source: "keyboard" }),
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      throw new Error(body?.error ?? "Could not start a ranked attempt.");
    }

    const attempt = (await response.json()) as AttemptResponse;
    attemptIdRef.current = attempt.attemptId;
    return attempt.scramble;
  }, []);

  const session = useSolveSession({
    nextScramble: supplyScramble,
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
          <RatingBar rating={rating} />
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
          <p className="text-xs text-muted-dim">
            {phase === "armed" && "Ranked attempt live — the first turn starts the clock."}
            {phase === "running" && `${moveCount} moves`}
            {phase === "solved" && (submitting ? "Verifying…" : "Solved")}
            {phase === "idle" && "Getting a scramble…"}
          </p>
        </div>

        {lastWindow ? <WindowResult result={lastWindow} /> : null}
        {status && !lastWindow ? (
          <p className="text-sm text-muted">{status}</p>
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
            {phase === "solved" ? "Next attempt" : "New attempt"}
          </button>
        </div>

        {connectError ? (
          <p className="max-w-md text-center text-xs text-danger">{connectError}</p>
        ) : null}

        <p className="max-w-md text-center text-xs leading-relaxed text-muted-dim">
          Your rating moves every {WINDOW_SIZE} attempts, as a WCA average of 5.
          Starting a new attempt before finishing this one records the current one
          as a DNF.
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
function RatingBar({ rating }: { rating: RankedRating }) {
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
            : `${formatMs(msForRating(rating.rating), { truncate: false })} pace`}
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
