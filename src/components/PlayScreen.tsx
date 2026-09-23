"use client";

import Link from "next/link";
import { useCallback, useRef, useState } from "react";

import { CubeView } from "@/components/CubeView";
import { KeyMapHint } from "@/components/KeyMapHint";
import { MovePad } from "@/components/MovePad";
import { SiteHeader } from "@/components/SiteHeader";
import { SolveSwitch } from "@/components/SolveSwitch";
import { SolveBreakdown } from "@/components/SolveBreakdown";
import { formatMs } from "@/lib/format";
import { countMoves, encodeMoveStream, type SolveRecording } from "@/lib/moveStream";
import { nextScramble, warmScrambles } from "@/lib/scramble";
import { recordSolve } from "@/lib/solveHistory";
import { useSolveSession } from "@/lib/useSolveSession";

/**
 * Cubing without a cube — the practice mode.
 *
 * The timer here is exact and automatic: it starts on the first layer turn and
 * stops the instant the cube reaches a solved state, because the app is watching
 * the actual puzzle rather than waiting for a thumb on a spacebar. That removes
 * both sources of error in a hand-timed solve — the reaction delay at each end.
 *
 * The loop itself lives in `useSolveSession`, shared with ranked. What is left
 * here is what makes this mode *practice*: scrambles come from the local
 * generator, results go to local history, and nothing is ever sent anywhere.
 */
export function PlayScreen({ initialScramble }: { initialScramble?: string | null }) {
  const [copied, setCopied] = useState(false);
  /**
   * How many moves the engine's route for this scramble takes — short, not
   * proven shortest (see SolveReport).
   *
   * The one thing a timer can never tell you. "22 seconds" says nothing about
   * whether the cube was hard or you went the long way round; "you used 58 moves
   * and the engine used 20" says which.
   */
  const [optimal, setOptimal] = useState<number | null>(null);
  /** Shortest cross available on the face they actually built on. */
  const [optimalCross, setOptimalCross] = useState<number | null>(null);
  const [reviewId, setReviewId] = useState<string | null>(null);

  // Consumed once: a challenge link pins the first scramble, then the session
  // continues with fresh ones rather than trapping the player on that puzzle.
  const pinnedScrambleRef = useRef(initialScramble ?? null);

  const supplyScramble = useCallback(async () => {
    warmScrambles("333");
    const pinned = pinnedScrambleRef.current;
    pinnedScrambleRef.current = null;
    setCopied(false);
    setOptimal(null);
    setOptimalCross(null);
    return pinned ?? (await nextScramble("333"));
  }, []);

  const session = useSolveSession({
    nextScramble: supplyScramble,
    onSolved: ({ scramble, recording, analysis, source }) => {
      // Fire and forget. Practice works offline and signed out, so failing to
      // reach the solver must cost nothing — the line simply does not appear.
      void fetch("/api/solve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scramble, crossFace: analysis.crossFace }),
      })
        .then((r) => (r.ok ? r.json() : null))
        .then(
          (data: { optimalMoves?: number; optimalCrossMoves?: number | null } | null) => {
            if (typeof data?.optimalMoves === "number") setOptimal(data.optimalMoves);
            if (typeof data?.optimalCrossMoves === "number") {
              setOptimalCross(data.optimalCrossMoves);
            }
          },
        )
        .catch(() => {});

      const saved = recordSolve({
        scramble,
        durationMs: recording.durationMs,
        penalty: "OK",
        moveCount: recording.stats.moveCount,
        tps: recording.stats.tps,
        splits: analysis.splits,
        ollCase: analysis.ollCase,
        pllCase: analysis.pllCase,
        ollSetup: analysis.ollSetup,
        pllSetup: analysis.pllSetup,
        source,
        moves: encodeMoveStream(recording.moves),
      });
      // The id the review page will look it up by. Null when storage refused
      // the write, so the button never promises a solve that is not there.
      const entry = saved[saved.length - 1];
      setReviewId(entry?.scramble === scramble ? entry.id : null);
    },
  });

  const {
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
  } = session;

  const solving = phase === "running";

  return (
    <main className="flex min-h-dvh flex-col">
      <SiteHeader active="play" />
      {/* The page title, for assistive tech. This screen is deliberately
          chrome-free — a visible heading beside the clock would be noise. */}
      <h1 className="sr-only">Keyboard cubing</h1>

      <div className="mx-auto grid w-full max-w-7xl flex-1 items-start gap-6 px-4 pb-10 pt-3 sm:px-8 lg:grid-cols-[minmax(0,1fr)_21rem] lg:gap-8 lg:pt-8">
        <div className="flex min-w-0 flex-col items-center gap-5 md:gap-6">
          <SolveSwitch
            active="keyboard"
            className={`transition-opacity duration-200 ${solving ? "opacity-30" : "opacity-100"}`}
          />

          <section
            className={`w-full rounded-2xl border border-border bg-surface px-4 py-4 transition-opacity duration-200 sm:px-6 ${
              solving ? "opacity-30" : "opacity-100"
            }`}
          >
            <div className="mb-2 flex items-center justify-between gap-3">
              <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-dim">
                Scramble · already applied
              </span>
              <span className="text-[11px] text-muted-dim">The cube below is scrambled for you</span>
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 font-mono text-base leading-snug sm:text-lg">
              {scramble.split(" ").map((move, i) => (
                <span key={`${move}-${i}`}>{move}</span>
              ))}
            </div>
          </section>

          <CubeView
            scramble={scramble}
            /*
             * cubing.js's own click/drag-to-turn input is deliberately NOT enabled.
             * It throws "internal parsing error" on load here, and I could not drive
             * it through synthetic pointer events to confirm it works at all — so it
             * would have been an unverifiable feature that also poisons the console.
             * The MovePad below is the touch path, and it is tested.
             */
            interactive
            backView="none"
            onPlayerReady={session.onPlayerReady}
            className="h-[30vh] max-h-80 min-h-44 w-full max-w-md"
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
            <p className="text-sm text-muted">
              {phase === "armed" &&
                "Make your first turn to start the clock. It stops by itself when the cube is solved."}
              {phase === "running" && `${moveCount} moves`}
              {phase === "solved" && "Solved"}
              {phase === "idle" && "Loading…"}
            </p>
          </div>

          {/* Touch first on small screens; the keyboard legend is useless there. */}
          <MovePad onMove={session.pushMove} className="md:hidden" />

          {recording ? (
            <SolveReport
              recording={recording}
              optimal={optimal}
              optimalCross={optimalCross}
              crossEndMs={splits?.find((s) => s.phase === "Cross")?.endMs ?? null}
            />
          ) : null}
          {splits && splits.length > 0 ? <SolveBreakdown splits={splits} /> : null}

          <div className="flex flex-wrap items-center justify-center gap-3">
            {/* After a solve the review is the first button, not the next
                scramble: a recommendation that has to win a click against
                "again" at the moment of highest emotion only gets read if it
                is the obvious one. */}
            {phase === "solved" && reviewId ? (
              <Link href={`/review?id=${encodeURIComponent(reviewId)}`} className="btn-go px-5 py-2.5 text-sm">
                Review this solve
              </Link>
            ) : null}
            <button
              type="button"
              onClick={() => void session.startRound()}
              className={`${phase === "solved" && reviewId ? "btn-secondary" : "btn-go"} px-5 py-2.5 text-sm`}
            >
              {phase === "solved" ? "Next scramble" : "New scramble"}
            </button>
            {phase === "solved" ? (
              <button
                type="button"
                onClick={() => {
                  const url = `${window.location.origin}/play?scramble=${encodeURIComponent(
                    session.scrambleRef.current,
                  )}`;
                  void navigator.clipboard
                    .writeText(url)
                    .then(() => {
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2000);
                    })
                    .catch(() => {});
                }}
                className="btn-secondary px-5 py-2.5 text-sm"
              >
                {copied ? "Link copied" : "Challenge a friend"}
              </button>
            ) : null}
            {support?.supported ? (
              <button
                type="button"
                onClick={() => void session.connectCube()}
                className="btn-secondary px-5 py-2.5 text-sm"
              >
                Connect smart cube
              </button>
            ) : null}
          </div>

          <p className="text-center text-xs text-muted-dim">
            {sourceName ? `Input: ${sourceName}` : "Connecting input…"}
            {support && !support.supported && support.reason ? (
              <span className="mt-1 block max-w-md text-muted-dim">{support.reason}</span>
            ) : null}
          </p>

          {connectError ? (
            <p className="max-w-md text-center text-xs text-danger">{connectError}</p>
          ) : null}

        </div>

        {/* The controls, beside the cube rather than under it. Always visible:
            a beginner needs the mapping on every move for their first sessions,
            and the key just pressed lights up so it is learned by use. */}
        <aside
          aria-label="Keyboard controls"
          className={`hidden flex-col gap-3 rounded-2xl border border-border bg-surface p-5 transition-opacity duration-200 md:flex lg:sticky lg:top-6 ${
            solving ? "opacity-40" : "opacity-100"
          }`}
        >
          <div className="flex flex-col gap-1">
            <h2 className="text-base">Keyboard controls</h2>
            <p className="text-xs leading-relaxed text-muted-dim">
              Each key turns one layer. The one you just pressed lights up.
            </p>
          </div>
          <KeyMapHint activeCode={activeKey} compact />
        </aside>
      </div>
    </main>
  );
}

/**
 * The seed of the analysis engine. Time alone tells a cuber nothing they can act
 * on; move count, turn speed and pause time separate "my hands are slow" from
 * "I don't know what to do next", which are opposite problems with opposite fixes.
 */
function SolveReport({
  recording,
  optimal,
  optimalCross,
  crossEndMs,
}: {
  recording: SolveRecording;
  /** Length of the engine's route for this scramble — short, not proven shortest. */
  optimal: number | null;
  /** The true minimum for the cross on the face they built, from an exact table. */
  optimalCross: number | null;
  crossEndMs: number | null;
}) {
  const { stats } = recording;
  const pausedPct = Math.round(stats.pausedFraction * 100);

  // Both comparisons are made in the half-turn metric, where R2 is one move —
  // the unit every solver answers in. The keyboard produces quarter turns, so the
  // cuber's side is counted the way cubers count it (R R is R2) rather than
  // compared raw, which overstated the waste by a move for every half turn. The
  // previous version doubled the solver's count instead and called it a floor;
  // it is a ceiling, and it flattered the cuber by the same amount.
  const solveMoves = countMoves(recording.moves.map((m) => m.move));
  const ratio = optimal !== null && optimal > 0 ? solveMoves / optimal : null;

  // Looked up by the phase's real name. It was looked up as "cross" — lower case
  // — which matches no phase the analysis writes, so this line had never once
  // been shown to anybody.
  const crossMoves =
    crossEndMs === null
      ? null
      : countMoves(recording.moves.filter((m) => m.atMs <= crossEndMs).map((m) => m.move));

  // Cross efficiency is the one number here a CFOP solver can act on this
  // afternoon. Total move count says "your method is long", which is true of
  // every method; the cross is the part you plan during inspection, so wasted
  // moves there are a decision rather than a limitation.
  //
  // The comparison is against the best cross on the face they ACTUALLY built,
  // not the easiest of the six — measuring a white-cross solver against a
  // colour-neutral optimum reports their colour neutrality, not their cross.
  const crossWaste =
    crossMoves !== null && optimalCross !== null ? crossMoves - optimalCross : null;

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-3">
        {/* Turns as typed — a half turn is two. "Moves" below are counted the
            way solvers count them, and the two words keep the units apart. */}
        <Metric label="turns" value={String(stats.moveCount)} />
        <Metric label="tps" value={stats.tps.toFixed(2)} />
        <Metric label="longest pause" value={formatMs(stats.longestPauseMs)} />
        <Metric label="paused" value={`${pausedPct}%`} />
        {optimal !== null ? <Metric label="engine" value={String(optimal)} /> : null}
        {crossWaste !== null ? (
          <Metric
            label="cross"
            value={`${crossMoves}/${optimalCross}`}
          />
        ) : null}
      </div>

      {crossWaste !== null ? (
        <p className="max-w-md text-center text-xs leading-relaxed text-muted-dim">
          {crossWaste <= 0
            ? `Your cross was optimal — ${optimalCross} moves was the shortest available on that face. Nothing to win back there.`
            : `Your cross took ${crossMoves} moves; the shortest on that face was ${optimalCross}. That is ${crossWaste} ${crossWaste === 1 ? "move" : "moves"} spent before F2L even starts, and the cross is the one phase you can plan entirely during inspection.`}
        </p>
      ) : null}

      {ratio !== null ? (
        <p className="max-w-md text-center text-xs leading-relaxed text-muted-dim" data-testid="engine-route">
          This site&apos;s engine solved this cube in {optimal} moves. You used {solveMoves},
          counted the same way — about {ratio.toFixed(1)}× its route. Every method
          takes more than that; CFOP typically runs three to four times it, so this
          is a measure of your method, not a mistake. The engine&apos;s route is short,
          not proven shortest: a random cube&apos;s true minimum is 17 or 18 moves
          about 95% of the time.
        </p>
      ) : null}
      <p className="max-w-md text-center text-xs leading-relaxed text-muted-dim">
        {pausedPct >= 40
          ? "Most of that solve was spent deciding, not turning. Recognition is the thing to drill, not hand speed."
          : "Little of that solve was spent paused — the time is going into execution rather than recognition."}
      </p>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-dim">{label}</span>
      <span className="tnum text-lg font-medium text-muted">{value}</span>
    </div>
  );
}
