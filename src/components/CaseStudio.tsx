"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { CubeView } from "@/components/CubeView";
import { LastLayerDiagram } from "@/components/LastLayerDiagram";
import { formatMs } from "@/lib/format";
import { holdForLastLayer, type LearnCase } from "@/lib/learn";
import { useSolveSession } from "@/lib/useSolveSession";
import { ConnectCubeMenu } from "@/components/ConnectCubeMenu";

/**
 * One case, on a cube you can actually turn.
 *
 * A case sheet tells you the moves. This is the thing a sheet cannot be: the
 * cube in front of you, in that exact state, with the algorithm running on it as
 * slowly as you like — and then the same cube handed back so you can do it
 * yourself, on the keyboard or on the cube in your hands.
 *
 * ## Why executing it returns to solved
 *
 * The case is built by running its algorithm backwards from a solved cube. So
 * performing the algorithm correctly does not merely orient or permute the last
 * layer — it puts the whole cube back exactly as it started. That is what makes
 * "did they get it right?" answerable without asking them: the cube says so.
 *
 * There is deliberately no "I got it" button. A trainer that takes your word for
 * it is a trainer measuring your confidence.
 */

type Mode = "watch" | "try";

/**
 * How high the camera sits when the subject is the last layer.
 *
 * cubing.js defaults to about 34 degrees, which is the right three-quarter view
 * for checking a scramble — all three visible faces matter equally there. Here
 * they do not: the case lives entirely on top, and at 34 degrees the U face is
 * foreshortened into a sliver you cannot read. Looking down at it is not a
 * stylistic preference, it is pointing the camera at the subject.
 *
 * Not straight down either. The side stickers are what tell you *which* of two
 * similar cases you are looking at, so they have to stay visible.
 */
const LAST_LAYER_LATITUDE = 62;

const TEMPOS = [
  { label: "Slow", ms: 900 },
  { label: "Steady", ms: 520 },
  { label: "Quick", ms: 260 },
] as const;

export interface Sibling {
  slug: string;
  label: string;
  setup: string;
}

export function CaseStudio({
  study,
  previous,
  next,
  siblings,
}: {
  study: LearnCase;
  previous: { slug: string; label: string } | null;
  next: { slug: string; label: string } | null;
  /** The other cases that look like this one. */
  siblings: Sibling[];
}) {
  const [mode, setMode] = useState<Mode>("watch");

  const moves = useMemo(() => study.alg.split(/\s+/).filter(Boolean), [study.alg]);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-center gap-2">
        <ModeTab active={mode === "watch"} onClick={() => setMode("watch")}>
          Watch it
        </ModeTab>
        <ModeTab active={mode === "try"} onClick={() => setMode("try")}>
          Try it
        </ModeTab>

        <div className="ml-auto flex items-center gap-3 text-xs">
          {previous ? (
            <Link href={`/learn/${previous.slug}`} className="text-muted-dim hover:text-foreground">
              ← {previous.label}
            </Link>
          ) : null}
          {next ? (
            <Link href={`/learn/${next.slug}`} className="text-muted-dim hover:text-foreground">
              {next.label} →
            </Link>
          ) : null}
        </div>
      </div>

      {mode === "watch" ? (
        <Watch study={study} moves={moves} />
      ) : (
        <Try study={study} moves={moves} />
      )}

      {siblings.length > 0 ? <Confusable study={study} siblings={siblings} /> : null}
    </div>
  );
}

/**
 * The cases this one is mistaken for.
 *
 * Knowing an algorithm is the easy half. The half that actually costs time is
 * telling a case apart from the four that look almost exactly like it, at speed,
 * having seen it for a third of a second — and you cannot practise that by
 * looking at one case at a time.
 *
 * So the cases sharing this one's shape are put next to it, at the size you
 * actually see them. Same shape is not a decorative grouping: it is precisely the
 * set that survives the first glance, which makes it precisely the set you have
 * to separate on the second.
 */
function Confusable({ study, siblings }: { study: LearnCase; siblings: Sibling[] }) {
  return (
    <section className="flex flex-col gap-4 border-t border-border pt-8">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg">
          Easy to confuse with
        </h2>
        <p className="max-w-lg text-xs leading-relaxed text-muted-dim">
          {study.stage === "OLL"
            ? `The other ${study.shape} cases. They read the same at a glance, which is exactly why they cost time.`
            : "The rest of PLL. Recognition is most of the speed here."}
        </p>
      </div>

      <ul className="grid list-none grid-cols-3 gap-3 p-0 sm:grid-cols-5 md:grid-cols-7 lg:grid-cols-9">
        <li>
          <div className="panel-raised flex flex-col gap-1.5 rounded-lg p-2">
            <LastLayerDiagram setup={study.setup} label={study.label} />
            <span className="truncate text-center text-[10px] text-foreground">
              this one
            </span>
          </div>
        </li>
        {siblings.map((s) => (
          <li key={s.slug}>
            <Link
              href={`/learn/${s.slug}`}
              className="panel lift flex flex-col gap-1.5 rounded-lg p-2 hover:border-muted-dim"
            >
              <LastLayerDiagram setup={s.setup} label={s.label} />
              <span className="truncate text-center text-[10px] text-muted-dim">
                {s.label.replace(/^(OLL|PLL) /, "")}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ModeTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-lg px-4 py-2 text-sm transition-colors ${
        active
          ? "bg-foreground text-background"
          : "border border-border text-muted hover:border-muted-dim"
      }`}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Watch
// ---------------------------------------------------------------------------

/**
 * The algorithm, run on the case, at a speed you choose.
 *
 * The cube's state is rewritten as `setup + the moves so far`, the same
 * technique the solve replay uses: scrubbing is then a pure function of the move
 * index, so the cube, the highlighted move and the counter can never disagree.
 */
function Watch({ study, moves }: { study: LearnCase; moves: string[] }) {
  const [at, setAt] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [tempo, setTempo] = useState<number>(TEMPOS[1].ms);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const atEnd = at >= moves.length;

  // Reaching the end simply stops scheduling. Setting `playing` to false from
  // inside the effect would be a second render triggered by the first, and the
  // button already reads its label from `atEnd` rather than from the flag.
  useEffect(() => {
    if (!playing || atEnd) return;
    timer.current = setTimeout(() => setAt((n) => n + 1), tempo);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // `at` belongs in here. The effect schedules exactly one step, so without it
    // the algorithm advances a single move and stops — which is precisely what
    // happened when this dependency was dropped while fixing something else.
    // The state change is inside the timeout, so re-running per move is not a
    // cascading render.
  }, [playing, atEnd, tempo, at]);

  const state = useMemo(() => {
    // Yellow on top, as the case is met in a solve — see LAST_LAYER_HOLD.
    const held = holdForLastLayer(study.setup);
    const done = moves.slice(0, at);
    return done.length > 0 ? `${held} ${done.join(" ")}` : held;
  }, [study.setup, moves, at]);

  const restart = useCallback(() => {
    setAt(0);
    setPlaying(true);
  }, []);

  return (
    <div className="grid items-start gap-10 md:grid-cols-[minmax(0,1.15fr)_minmax(0,19rem)]">
      <div className="cube-stage relative mx-auto aspect-square w-full max-w-lg">
        <CubeView
          scramble={state}
          interactive
          backView="top-right"
          cameraLatitude={LAST_LAYER_LATITUDE}
          className="h-full w-full"
        />
      </div>

      <div className="panel flex flex-col gap-6 rounded-2xl p-5">
        <div className="flex flex-col gap-3">
          <h2 className="text-lg">
            The algorithm
          </h2>
          <div className="flex flex-wrap gap-1.5">
            {moves.map((move, i) => (
              <button
                key={i}
                type="button"
                onClick={() => {
                  setPlaying(false);
                  setAt(i + 1);
                }}
                className={`rounded-md px-2 py-1.5 font-mono text-sm transition-colors ${
                  i === at - 1
                    ? "bg-foreground text-background"
                    : i < at
                      ? "bg-surface text-foreground"
                      : "text-muted-dim hover:bg-surface"
                }`}
              >
                {move}
              </button>
            ))}
          </div>
          <p className="font-mono text-xs text-muted-dim">
            {at} of {moves.length}
          </p>
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => (atEnd ? restart() : setPlaying((p) => !p))}
              className="btn-go px-5 py-2.5 text-sm"
            >
              {atEnd ? "Again" : playing ? "Pause" : "Play"}
            </button>
            <button
              type="button"
              onClick={() => {
                setPlaying(false);
                setAt((n) => Math.max(0, n - 1));
              }}
              className="rounded-lg border border-border px-3 py-2.5 text-sm transition-colors hover:border-muted-dim"
              aria-label="Back one move"
            >
              ←
            </button>
            <button
              type="button"
              onClick={() => {
                setPlaying(false);
                setAt((n) => Math.min(moves.length, n + 1));
              }}
              className="rounded-lg border border-border px-3 py-2.5 text-sm transition-colors hover:border-muted-dim"
              aria-label="Forward one move"
            >
              →
            </button>
          </div>

          <div className="flex items-center gap-1">
            {TEMPOS.map((t) => (
              <button
                key={t.label}
                type="button"
                onClick={() => setTempo(t.ms)}
                aria-pressed={tempo === t.ms}
                className={`rounded px-2.5 py-1 text-xs transition-colors ${
                  tempo === t.ms ? "bg-surface text-foreground" : "text-muted-dim hover:text-muted"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <p className="text-xs leading-relaxed text-muted-dim">
          The cube starts in the case and ends solved, because the case is made by
          running this algorithm backwards from a solved cube. Drag the cube to
          look at it from anywhere.
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Try
// ---------------------------------------------------------------------------

/**
 * The same case, handed over.
 *
 * `useSolveSession` carries both inputs, so the keyboard and a Bluetooth cube are
 * the same code path here — which is the point. Learning a case on the keyboard
 * and then never being able to do it on a real cube is the failure mode of every
 * algorithm trainer, and the fix is to let the real cube be the input from the
 * first repetition.
 */
function Try({ study, moves }: { study: LearnCase; moves: string[] }) {
  const [times, setTimes] = useState<number[]>([]);

  // The drill is held the same way as the picture, so the keys match what is seen.
  const supply = useCallback(async () => holdForLastLayer(study.setup), [study.setup]);

  const session = useSolveSession({
    nextScramble: supply,
    autoStart: true,
    onSolved: ({ recording }) => {
      setTimes((previous) => [recording.durationMs, ...previous].slice(0, 12));
    },
  });

  // Destructured rather than read through `session.x`, which is how every other
  // screen here uses this hook: the session carries refs, and reading any
  // property off it during render trips the refs rule.
  //
  // `support` comes from the session rather than being probed again here.
  // `navigator` does not exist on the server, so it has to resolve after mount —
  // and probing twice means two answers that can disagree.
  const { support, sourceName, connectError, connectCube, displayRef, onPlayerReady } =
    session;

  const best = times.length > 0 ? Math.min(...times) : null;
  const last = times[0] ?? null;

  return (
    <div className="grid items-start gap-10 md:grid-cols-[minmax(0,1.15fr)_minmax(0,19rem)]">
      <div className="flex flex-col gap-4">
        <div className="cube-stage relative mx-auto aspect-square w-full max-w-lg">
          <CubeView
            scramble={session.scramble || holdForLastLayer(study.setup)}
            interactive
            backView="top-right"
            movePressInput
            cameraLatitude={LAST_LAYER_LATITUDE}
            onPlayerReady={onPlayerReady}
            className="h-full w-full"
          />
        </div>
        <div
          ref={displayRef}
          className="tnum text-center font-mono text-4xl font-medium"
        >
          0.00
        </div>
      </div>

      <div className="panel flex flex-col gap-6 rounded-2xl p-5">
        <div className="flex flex-col gap-2">
          <h2 className="text-lg">
            Your cube
          </h2>
          {support?.supported ? (
            <>
              <ConnectCubeMenu
                label="Connect a smart cube"
                onConnect={(family) => void connectCube(family)}
                className="self-start rounded-lg border border-border px-4 py-2.5 text-sm transition-colors hover:border-muted-dim"
              />
              <p className="text-xs leading-relaxed text-muted-dim">
                {sourceName
                  ? `Connected: ${sourceName}. Turn your cube and it turns here.`
                  : "Or just use the keyboard — the key map is under the timer."}
              </p>
            </>
          ) : (
            <p className="text-xs leading-relaxed text-muted-dim">
              {support?.reason ?? "Checking what this browser can do…"}
            </p>
          )}
          {connectError ? (
            <p className="text-xs text-danger">{connectError}</p>
          ) : null}
        </div>

        <div className="flex flex-col gap-3">
          <h2 className="text-lg">
            If you get stuck
          </h2>
          <p className="font-mono text-sm leading-relaxed">{moves.join(" ")}</p>
          <p className="text-xs leading-relaxed text-muted-dim">
            {study.moveCount} moves. The cube resets itself the moment you finish,
            so a repetition costs nothing.
          </p>
        </div>

        {times.length > 0 ? (
          <div className="flex flex-col gap-3">
            <h2 className="text-lg">
              This session
            </h2>
            <div className="flex gap-6">
              <Stat label="last" value={last === null ? "—" : formatMs(last)} />
              <Stat label="best" value={best === null ? "—" : formatMs(best)} />
              <Stat label="reps" value={String(times.length)} />
            </div>
          </div>
        ) : (
          <p className="text-xs leading-relaxed text-muted-dim">
            The cube is already in the case. Start turning and the clock starts
            with you.
          </p>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="tnum font-mono text-lg">{value}</span>
      <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-dim">{label}</span>
    </div>
  );
}
