"use client";

import { useCallback, useRef, useState } from "react";

import { CubeView } from "@/components/CubeView";
import { KeyMapHint } from "@/components/KeyMapHint";
import { MovePad } from "@/components/MovePad";
import { SiteHeader } from "@/components/SiteHeader";
import { SolveBreakdown } from "@/components/SolveBreakdown";
import { formatMs } from "@/lib/format";
import type { SolveRecording } from "@/lib/moveStream";
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

  // Consumed once: a challenge link pins the first scramble, then the session
  // continues with fresh ones rather than trapping the player on that puzzle.
  const pinnedScrambleRef = useRef(initialScramble ?? null);

  const supplyScramble = useCallback(async () => {
    warmScrambles("333");
    const pinned = pinnedScrambleRef.current;
    pinnedScrambleRef.current = null;
    setCopied(false);
    return pinned ?? (await nextScramble("333"));
  }, []);

  const session = useSolveSession({
    nextScramble: supplyScramble,
    onSolved: ({ scramble, recording, analysis, source }) => {
      recordSolve({
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
      });
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

      <div className="flex flex-1 flex-col items-center gap-6 px-6 pb-10">
        <div
          className={`flex w-full flex-col items-center gap-6 transition-opacity duration-200 ${
            solving ? "opacity-30" : "opacity-100"
          }`}
        >
          <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-center gap-x-3 gap-y-1.5 font-mono text-base leading-snug sm:text-lg">
            {scramble.split(" ").map((move, i) => (
              <span key={`${move}-${i}`}>{move}</span>
            ))}
          </div>
        </div>

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
            {phase === "armed" &&
              "Turn the cube to start the clock — buttons below on a phone, or the keyboard."}
            {phase === "running" && `${moveCount} moves`}
            {phase === "solved" && "Solved"}
            {phase === "idle" && "Loading…"}
          </p>
        </div>

        {recording ? <SolveReport recording={recording} /> : null}
        {splits && splits.length > 0 ? <SolveBreakdown splits={splits} /> : null}

        <div className="flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => void session.startRound()}
            className="rounded-lg bg-foreground px-5 py-2.5 text-sm font-medium text-background transition-opacity hover:opacity-90"
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
              className="rounded-lg border border-border px-5 py-2.5 text-sm text-muted transition-colors hover:border-muted-dim hover:text-foreground"
            >
              {copied ? "Link copied" : "Challenge a friend"}
            </button>
          ) : null}
          {support?.supported ? (
            <button
              type="button"
              onClick={() => void session.connectCube()}
              className="rounded-lg border border-border px-5 py-2.5 text-sm text-muted transition-colors hover:border-muted-dim hover:text-foreground"
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

        {/* Touch first on small screens; the keyboard legend is useless there. */}
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
 * The seed of the analysis engine. Time alone tells a cuber nothing they can act
 * on; move count, turn speed and pause time separate "my hands are slow" from
 * "I don't know what to do next", which are opposite problems with opposite fixes.
 */
function SolveReport({ recording }: { recording: SolveRecording }) {
  const { stats } = recording;
  const pausedPct = Math.round(stats.pausedFraction * 100);

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-3">
        <Metric label="moves" value={String(stats.moveCount)} />
        <Metric label="tps" value={stats.tps.toFixed(2)} />
        <Metric label="longest pause" value={formatMs(stats.longestPauseMs)} />
        <Metric label="paused" value={`${pausedPct}%`} />
      </div>
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
      <span className="text-[10px] uppercase tracking-widest text-muted-dim">{label}</span>
      <span className="tnum text-lg font-medium text-muted">{value}</span>
    </div>
  );
}
