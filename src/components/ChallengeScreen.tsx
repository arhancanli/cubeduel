"use client";

import Link from "next/link";
import { useCallback, useRef, useState } from "react";

import { CubeView } from "@/components/CubeView";
import { InspectionCountdown } from "@/components/InspectionCountdown";
import { KeyMapHint } from "@/components/KeyMapHint";
import { MovePad } from "@/components/MovePad";
import { SiteHeader } from "@/components/SiteHeader";
import type { Side } from "@/lib/challenge";
import { formatMs } from "@/lib/format";
import { useSolveSession } from "@/lib/useSolveSession";

/**
 * Solving your half of a challenge.
 *
 * Deliberately shows no opponent progress bar, unlike a bot duel. There is
 * nothing honest to put there: the other player might be solving right now or
 * might be asleep, and their time is withheld until you are both in. A bar that
 * moved would be an animation pretending to be information.
 *
 * What it does show is the countdown, because inspection starts the moment the
 * scramble appears and the player is entitled to see the clock they are being
 * judged against.
 */

interface StartResponse {
  ok?: boolean;
  scramble?: string;
  error?: string;
}

interface SubmitResponse {
  accepted?: boolean;
  reason?: string;
  penalty?: "OK" | "PLUS2" | "DNF";
  inspectionReason?: string;
  settled?: boolean;
  outcome?: "win" | "loss" | "draw" | null;
  own?: Side;
  theirs?: Side | null;
}

export interface ChallengeScreenProps {
  challengeId: string;
  opponentHandle: string;
  /** Already opened on a previous visit, so inspection is already running. */
  alreadyStarted: boolean;
}

export function ChallengeScreen({
  challengeId,
  opponentHandle,
  alreadyStarted,
}: ChallengeScreenProps) {
  const [started, setStarted] = useState(false);
  const [result, setResult] = useState<SubmitResponse | null>(null);
  const [rejection, setRejection] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submittedRef = useRef(false);

  const supplyScramble = useCallback(async () => {
    setRejection(null);
    submittedRef.current = false;

    const response = await fetch("/api/challenge/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ challengeId }),
    });
    const body = (await response.json().catch(() => null)) as StartResponse | null;
    if (!response.ok || !body?.scramble) {
      throw new Error(body?.error ?? "Could not open this challenge.");
    }
    return body.scramble;
  }, [challengeId]);

  const session = useSolveSession({
    nextScramble: supplyScramble,
    // Opening the scramble starts inspection and cannot be undone, so it takes a
    // deliberate press. Nobody should burn their one attempt by following a link.
    autoStart: false,
    onRoundError: (message) => setRejection(message),
    onSolved: ({ recording, analysis, source }) => {
      if (submittedRef.current) return;
      submittedRef.current = true;
      setSubmitting(true);

      void fetch("/api/challenge/submit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          challengeId,
          clientId: `ch_${challengeId}`,
          durationMs: recording.durationMs,
          penalty: "OK",
          source,
          moves: recording.moves.map((m) => ({ move: m.move, atMs: m.atMs })),
          splits: analysis.splits,
        }),
      })
        .then(async (response) => {
          const body = (await response.json().catch(() => null)) as SubmitResponse | null;
          setSubmitting(false);
          if (!body?.accepted) {
            setRejection(body?.reason ?? "That solve could not be verified.");
            return;
          }
          setResult(body);
        })
        .catch(() => {
          setSubmitting(false);
          setRejection("Could not reach the server. That solve was not recorded.");
        });
    },
  });

  const { scramble, phase, moveCount, connectError, activeKey, displayRef } = session;
  const solving = phase === "running";

  return (
    <main className="flex min-h-dvh flex-col">
      <SiteHeader active="duel" />

      <div className="flex flex-1 flex-col items-center gap-6 px-6 pb-12">
        <div className={`text-center ${solving ? "opacity-0" : "opacity-100 transition-opacity"}`}>
          <h1 className="text-lg tracking-tight">
            Challenge from{" "}
            <Link href={`/u/${opponentHandle}`} className="underline underline-offset-4">
              {opponentHandle}
            </Link>
          </h1>
          <p className="mt-1 text-xs text-muted-dim">
            The same scramble you both solve. Neither time is shown until you have both finished.
          </p>
        </div>

        {!started && !result ? (
          <div className="flex max-w-md flex-col items-center gap-5 pt-6 text-center">
            <p className="text-sm leading-relaxed text-muted">
              {alreadyStarted
                ? "You already opened this one. The clock has been running since then — it does not restart."
                : "Opening this reveals the scramble and starts your inspection. There is one attempt, and it cannot be reopened for a fresh fifteen seconds."}
            </p>
            <button
              type="button"
              onClick={() => {
                setStarted(true);
                void session.startRound();
              }}
              className="btn-go px-6 py-2.5 text-sm"
            >
              {alreadyStarted ? "Show the scramble" : "Open the scramble"}
            </button>
          </div>
        ) : null}

        {started || result ? (
          <>
            <div
              className={`mx-auto flex max-w-5xl flex-wrap items-center justify-center gap-x-3 gap-y-1.5 font-mono text-base leading-snug transition-opacity duration-200 sm:text-lg ${
                solving ? "opacity-30" : "opacity-100"
              }`}
            >
              {scramble
                ? scramble.split(" ").map((move, i) => <span key={`${move}-${i}`}>{move}</span>)
                : null}
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
                className={`tnum font-display text-6xl font-bold leading-none tracking-tighter transition-colors sm:text-7xl ${
                  phase === "solved" ? "text-ready" : "text-foreground"
                }`}
              >
                0.00
              </div>

              <InspectionCountdown active={phase === "armed"} />

              <p className="text-xs text-muted-dim">
                {phase === "armed" && "The first turn starts the clock."}
                {phase === "running" && `${moveCount} moves`}
                {phase === "solved" && (submitting ? "Verifying…" : "Solved")}
                {phase === "idle" && "Getting the scramble…"}
              </p>
            </div>

            {phase !== "solved" ? (
              <MovePad onMove={session.pushMove} className="md:hidden" />
            ) : null}
          </>
        ) : null}

        {result ? <Verdict result={result} opponentHandle={opponentHandle} /> : null}

        {rejection ? (
          <p className="max-w-md rounded-lg border border-danger/40 bg-danger/5 px-4 py-3 text-center text-xs leading-relaxed text-danger">
            {rejection}
          </p>
        ) : null}

        {connectError ? (
          <p className="text-xs text-danger">{connectError}</p>
        ) : null}

        <div className="mt-2 hidden md:block">
          <KeyMapHint activeCode={activeKey} />
        </div>
      </div>
    </main>
  );
}

/**
 * The result.
 *
 * Two shapes, because a challenge finishes in two different situations: you went
 * first and there is nothing to compare yet, or you went second and it is
 * decided. Showing a made-up "waiting" score in the first case would be the one
 * thing this feature exists not to do.
 */
function Verdict({
  result,
  opponentHandle,
}: {
  result: SubmitResponse;
  opponentHandle: string;
}) {
  const own = result.own;
  const theirs = result.theirs;

  const headline =
    result.outcome === "win"
      ? "You won"
      : result.outcome === "loss"
        ? "You lost"
        : result.outcome === "draw"
          ? "A draw"
          : "Recorded";

  const tone =
    result.outcome === "win"
      ? "text-ready"
      : result.outcome === "loss"
        ? "text-danger"
        : "text-foreground";

  return (
    <div className="flex w-full max-w-md flex-col items-center gap-4 rounded-xl border border-border px-6 py-6 text-center">
      <p className={`text-xl font-medium tracking-tight ${tone}`}>{headline}</p>

      {result.settled && own && theirs ? (
        <div className="grid w-full grid-cols-2 gap-4 text-sm">
          <div>
            <div className="text-[10px] uppercase tracking-widest text-muted-dim">You</div>
            <div className="tnum mt-1 text-lg">{describe(own)}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-widest text-muted-dim">
              {opponentHandle}
            </div>
            <div className="tnum mt-1 text-lg">{describe(theirs)}</div>
          </div>
        </div>
      ) : (
        <p className="text-sm leading-relaxed text-muted">
          Your time is in{own ? `: ${describe(own)}` : ""}. It stays hidden until{" "}
          {opponentHandle} has solved the same scramble — knowing the target is
          worth too much to hand over.
        </p>
      )}

      {result.penalty && result.penalty !== "OK" ? (
        <p className="text-xs leading-relaxed text-holding">
          {result.inspectionReason || `A ${result.penalty} was applied.`}
        </p>
      ) : null}

      <Link
        href="/duel"
        className="rounded-lg border border-border px-4 py-2 text-xs text-muted transition-colors hover:border-muted-dim hover:text-foreground"
      >
        Back to duels
      </Link>
    </div>
  );
}

function describe(side: Side): string {
  if (side.penalty === "DNF") return "DNF";
  if (side.durationMs === null) return "—";
  const base = formatMs(side.durationMs);
  return side.penalty === "PLUS2" ? `${base} (+2)` : base;
}
