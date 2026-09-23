"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { CubeView } from "@/components/CubeView";
import { InspectionCountdown } from "@/components/InspectionCountdown";
import { KeyMapHint } from "@/components/KeyMapHint";
import { MovePad } from "@/components/MovePad";
import { SiteHeader } from "@/components/SiteHeader";
import { liveStage } from "@/lib/cfop";
import { EVENTS, eventOf } from "@/lib/events";
import { formatMs } from "@/lib/format";
import { RACE_STAGES, type RacePhase, type RaceProgress, type RaceSeat, type RaceWinner } from "@/lib/race";
import type { Penalty } from "@/lib/types";
import { useSolveSession } from "@/lib/useSolveSession";

/**
 * A live race, on one screen per player.
 *
 * Everything that decides the race comes from the server and is only drawn
 * here: the countdown is placed on the server's clock (the offset measured on
 * every poll), the scramble arrives only once the race has started, and the
 * result is the server's verdict on both replayed solves. What this screen adds
 * is the part a race needs and a challenge deliberately does not have — the other
 * player's progress, while it is happening.
 *
 * Endpoints are named once, as plain strings, so the repository audit can see
 * that each one has a route.
 */

const STATE = "/api/race/state";
const JOIN = "/api/race/join";
const READY = "/api/race/ready";
const PROGRESS = "/api/race/progress";
const SUBMIT = "/api/race/submit";
const REMATCH = "/api/race/rematch";

interface Player {
  handle: string;
  displayName: string;
  ready: boolean;
  progress: RaceProgress | null;
  result: { durationMs: number; penalty: Penalty } | null;
}

interface View {
  code: string;
  event: string;
  phase: RacePhase;
  serverNow: number;
  startAt: number | null;
  scramble: string | null;
  you: RaceSeat | null;
  host: Player;
  guest: Player | null;
  winner: RaceWinner | null;
  rematchCode: string | null;
}

/** How often each phase asks the server. The countdown and the race want it fresh. */
const POLL_MS: Record<RacePhase, number> = {
  lobby: 1500,
  countdown: 400,
  racing: 700,
  finished: 3000,
  abandoned: 0,
};

const STAGE_LABELS = [
  "Starting",
  "Cross",
  "1 of 4 pairs",
  "2 of 4 pairs",
  "3 of 4 pairs",
  "First two layers",
  "Last layer oriented",
  "Solved",
];

async function post(path: string, body: unknown): Promise<{ ok: boolean; data: Record<string, unknown> | null }> {
  try {
    const response = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return { ok: response.ok, data: (await response.json().catch(() => null)) as Record<string, unknown> | null };
  } catch {
    return { ok: false, data: null };
  }
}

export function RaceScreen({
  code,
  signedIn,
  siteUrl,
}: {
  code: string;
  signedIn: boolean;
  /** This deployment's address, for the link to send — from the server, so it is right on first render. */
  siteUrl: string;
}) {
  const router = useRouter();
  const [view, setView] = useState<View | null>(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [myStage, setMyStage] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  // Server time minus local time, measured at the midpoint of each poll. Held
  // twice: the ref for timers set up in effects, the state for drawing.
  const offsetRef = useRef(0);
  const [offset, setOffset] = useState(0);
  const scrambleRef = useRef<string | null>(null);
  const startedRef = useRef(false);
  const submittedRef = useRef(false);

  const refresh = useCallback(async () => {
    const sent = Date.now();
    try {
      const response = await fetch(`${STATE}?code=${encodeURIComponent(code)}`, { cache: "no-store" });
      if (response.status === 404) {
        setMissing(true);
        return;
      }
      if (!response.ok) return;
      const next = (await response.json()) as View;
      offsetRef.current = next.serverNow - (sent + Date.now()) / 2;
      setOffset(offsetRef.current);
      setView(next);
    } catch {
      // A missed poll is retried by the next one; saying so would be noise.
    }
  }, [code]);

  // Poll at the pace the phase needs — once straight away, then on a timer.
  const phase = view?.phase ?? "lobby";
  useEffect(() => {
    const every = POLL_MS[phase];
    const first = window.setTimeout(() => void refresh(), 0);
    const id = every ? window.setInterval(() => void refresh(), every) : undefined;
    return () => {
      window.clearTimeout(first);
      if (id !== undefined) window.clearInterval(id);
    };
  }, [phase, refresh]);

  // A clock for the countdown, and a poll timed for the moment the scramble is
  // released — so it appears within a round trip of the start, not a poll later.
  useEffect(() => {
    if (phase !== "countdown" || !view?.startAt) return;
    const tick = window.setInterval(() => setNow(Date.now()), 100);
    const wait = view.startAt - (Date.now() + offsetRef.current) + 40;
    const release = window.setTimeout(() => void refresh(), Math.max(0, wait));
    return () => {
      window.clearInterval(tick);
      window.clearTimeout(release);
    };
  }, [phase, view?.startAt, refresh]);

  const session = useSolveSession({
    nextScramble: async () => {
      if (!scrambleRef.current) throw new Error("The race has not started.");
      return scrambleRef.current;
    },
    // The scramble exists only once the race starts; the round begins then.
    autoStart: false,
    onRoundError: (message) => setError(message),
    onSolved: ({ recording, source }) => {
      if (submittedRef.current) return;
      submittedRef.current = true;
      setSubmitting(true);
      setMyStage(RACE_STAGES);
      void post(SUBMIT, {
        code,
        clientId: `race_${code}`,
        durationMs: recording.durationMs,
        penalty: "OK",
        source,
        moves: recording.moves.map((m) => ({ move: m.move, atMs: m.atMs })),
      }).then(({ data }) => {
        setSubmitting(false);
        if (!data?.accepted) setError((data?.reason as string) ?? "That solve could not be verified.");
        void refresh();
      });
    },
  });

  const {
    scramble: sessionScramble,
    phase: sessionPhase,
    moveCount,
    connectError,
    activeKey,
    displayRef,
    onPlayerReady,
    pushMove,
    startRound,
    liveMoves,
  } = session;
  const seated = view?.you ?? null;

  // The moment the scramble arrives, the round begins — inspection is already
  // running on the server's clock from the start time.
  useEffect(() => {
    if (!view || !seated || startedRef.current) return;
    if (view.phase === "racing" && view.scramble) {
      startedRef.current = true;
      scrambleRef.current = view.scramble;
      void startRound();
    }
  }, [view, seated, startRound]);

  // Report how far through the solve this player is, when it changes.
  const lastSentRef = useRef("");
  useEffect(() => {
    if (sessionPhase !== "running" || !scrambleRef.current) return;
    const id = window.setInterval(() => {
      const moves = liveMoves();
      void liveStage(scrambleRef.current!, moves).then((stage) => {
        setMyStage(stage);
        const key = `${stage}:${moves.length}`;
        if (key === lastSentRef.current) return;
        lastSentRef.current = key;
        void post(PROGRESS, { code, progress: { stage, turns: moves.filter((m) => !/^[xyz]/.test(m)).length } });
      });
    }, 700);
    return () => window.clearInterval(id);
  }, [sessionPhase, liveMoves, code]);

  // The other player has asked for a rematch: follow them into it.
  const rematchCode = view?.rematchCode ?? null;

  async function act(path: string, body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    const { ok, data } = await post(path, { code, ...body });
    setBusy(false);
    if (!ok) setError((data?.error as string) ?? "Something went wrong.");
    await refresh();
    return { ok, data };
  }

  async function goToRematch() {
    const { ok, data } = await act(REMATCH, {});
    if (ok && typeof data?.code === "string") router.push(`/race/${data.code}`);
  }

  if (missing) {
    return (
      <Shell>
        <h1 className="text-2xl tracking-tight">No such race</h1>
        <p className="mt-3 text-sm text-muted">
          The link may be mistyped, or the race has gone. <Link href="/race" className="underline underline-offset-4">Start a new one</Link>.
        </p>
      </Shell>
    );
  }
  if (!view) return <Shell><p className="text-sm text-muted-dim">Loading the race…</p></Shell>;

  const me = seated ? (seated === "host" ? view.host : view.guest) : null;
  const them = seated ? (seated === "host" ? view.guest : view.host) : null;
  const shareUrl = `${siteUrl}/race/${view.code}`;
  const eventName = EVENTS[eventOf(view.event).id].name;
  const solving = sessionPhase === "running";
  const countdownLeft =
    view.phase === "countdown" && view.startAt ? Math.max(0, view.startAt - (now + offset)) : 0;

  return (
    <Shell>
      <div className={`flex flex-col items-center gap-1 text-center ${solving ? "opacity-40" : ""}`}>
        <h1 className="text-lg tracking-tight">
          {eventName} race · <span className="font-mono">{view.code}</span>
        </h1>
        <p className="text-xs text-muted-dim">
          Same scramble, same moment. The server issues it at the start and checks both solves.
        </p>
      </div>

      {/* Seats — and, once racing, how far through each player is. */}
      <div className="grid w-full max-w-xl grid-cols-2 gap-3" data-testid="race-seats">
        <Seat
          label={seated === "host" ? "You" : "Host"}
          player={view.host}
          phase={view.phase}
          stage={seated === "host" ? myStage : undefined}
          turns={seated === "host" ? moveCount : undefined}
        />
        <Seat
          label={seated === "guest" ? "You" : "Opponent"}
          player={view.guest}
          phase={view.phase}
          stage={seated === "guest" ? myStage : undefined}
          turns={seated === "guest" ? moveCount : undefined}
        />
      </div>

      {view.phase === "lobby" ? (
        <div className="flex w-full max-w-xl flex-col items-center gap-4">
          {!view.guest && seated === "host" ? (
            <div className="flex w-full flex-col gap-2">
              <p className="text-center text-sm text-muted">Send this to the person you want to race.</p>
              <div className="flex items-stretch overflow-hidden rounded-lg border border-border">
                <input
                  readOnly
                  value={shareUrl}
                  aria-label="Race link"
                  data-testid="race-link"
                  className="min-w-0 flex-1 bg-surface px-3 py-2 font-mono text-xs"
                />
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard?.writeText(shareUrl).then(() => setCopied(true));
                  }}
                  className="border-l border-border px-3 text-xs text-muted hover:text-foreground"
                >
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
            </div>
          ) : null}

          {!seated && !view.guest ? (
            signedIn ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void act(JOIN, {})}
                className="btn-go px-6 py-2.5 text-sm disabled:opacity-50"
              >
                Take the seat
              </button>
            ) : (
              <p className="text-center text-sm text-muted">
                <Link href={`/join?next=/race/${view.code}`} className="text-foreground underline underline-offset-4">
                  Create an account
                </Link>{" "}
                or{" "}
                <Link href={`/sign-in?next=/race/${view.code}`} className="text-foreground underline underline-offset-4">
                  sign in
                </Link>{" "}
                to take the seat. A race result has to belong to somebody.
              </p>
            )
          ) : null}

          {seated && view.guest ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void act(READY, { ready: !me?.ready })}
              data-testid="race-ready"
              className={`px-6 py-2.5 text-sm disabled:opacity-50 ${
                me?.ready ? "rounded-lg border border-border font-medium text-muted" : "btn-go"
              }`}
            >
              {me?.ready ? "Not ready" : "Ready"}
            </button>
          ) : null}
          {seated && view.guest ? (
            <p className="text-xs text-muted-dim">
              {me?.ready && !them?.ready
                ? `Waiting for ${them?.displayName ?? "them"} to be ready.`
                : "The countdown starts when you are both ready."}
            </p>
          ) : null}
          <p className="max-w-md text-center text-xs leading-relaxed text-muted-dim">
            The faster solve wins, not the first to finish: each of you has fifteen seconds to
            inspect, as in competition, and the clock starts on your first turn.
          </p>
        </div>
      ) : null}

      {view.phase === "countdown" ? (
        <div className="flex flex-col items-center gap-2" aria-live="assertive">
          <div className="tnum font-display text-7xl font-bold" data-testid="race-countdown">
            {Math.ceil(countdownLeft / 1000)}
          </div>
          <p className="text-xs text-muted-dim">The scramble appears for both of you at zero.</p>
        </div>
      ) : null}

      {seated && (view.phase === "racing" || view.phase === "finished") && sessionScramble ? (
        <>
          <div
            className={`mx-auto flex max-w-5xl flex-wrap items-center justify-center gap-x-3 gap-y-1.5 font-mono text-base leading-snug sm:text-lg ${
              solving ? "opacity-30" : ""
            }`}
            data-testid="race-scramble"
          >
            {sessionScramble.split(" ").map((move, i) => (
              <span key={`${move}-${i}`}>{move}</span>
            ))}
          </div>
          <CubeView
            scramble={sessionScramble}
            interactive
            onPlayerReady={onPlayerReady}
            className="h-[26vh] max-h-64 min-h-36 w-full max-w-lg"
          />
          <div className="flex flex-col items-center gap-2">
            <div
              ref={displayRef}
              className={`tnum font-display text-6xl font-bold leading-none tracking-tighter sm:text-7xl ${
                sessionPhase === "solved" ? "text-ready" : "text-foreground"
              }`}
            >
              0.00
            </div>
            <InspectionCountdown active={sessionPhase === "armed"} />
            <p className="text-xs text-muted-dim">
              {sessionPhase === "armed" && "The first turn starts your clock."}
              {sessionPhase === "running" && `${moveCount} moves`}
              {sessionPhase === "solved" && (submitting ? "Verifying…" : "Solved")}
            </p>
          </div>
          {sessionPhase !== "solved" ? <MovePad onMove={pushMove} className="md:hidden" /> : null}
        </>
      ) : null}

      {view.phase === "finished" ? (
        <Result view={view} seated={seated} busy={busy} onRematch={() => void goToRematch()} />
      ) : null}

      {view.phase === "abandoned" ? (
        <p className="text-sm text-muted">
          This race lapsed before it started. <Link href="/race" className="underline underline-offset-4">Start another</Link>.
        </p>
      ) : null}

      {rematchCode && view.phase === "finished" ? (
        <p className="text-xs text-muted-dim" data-testid="rematch-waiting">
          A rematch is waiting.
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="max-w-md rounded-lg border border-danger/40 bg-danger/5 px-4 py-3 text-center text-xs text-danger">
          {error}
        </p>
      ) : null}
      {connectError ? <p className="text-xs text-danger">{connectError}</p> : null}

      {seated ? (
        <div className="mt-2 hidden md:block">
          <KeyMapHint activeCode={activeKey} />
        </div>
      ) : null}
    </Shell>
  );
}

function Seat({
  label,
  player,
  phase,
  stage,
  turns,
}: {
  label: string;
  player: Player | null;
  phase: RacePhase;
  /** This viewer's own stage and turns, measured here rather than waiting for the server. */
  stage?: number;
  turns?: number;
}) {
  if (!player) {
    return (
      <div className="flex flex-col gap-1 rounded-xl border border-dashed border-border px-4 py-3">
        <span className="text-[10px] uppercase tracking-widest text-muted-dim">{label}</span>
        <span className="text-sm text-muted-dim">Waiting for someone to open the link…</span>
      </div>
    );
  }
  const shownStage = stage ?? player.progress?.stage ?? 0;
  // Turns as well as the stage: on a hard scramble the stage can sit at the
  // start for a long time, and a bar that does not move cannot tell "still
  // turning" from "walked away".
  const shownTurns = turns ?? player.progress?.turns ?? 0;
  const racing = phase === "racing" || phase === "finished";
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border px-4 py-3" data-testid={`seat-${label.toLowerCase()}`}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[10px] uppercase tracking-widest text-muted-dim">{label}</span>
        {phase === "lobby" ? (
          <span className={`text-[10px] uppercase tracking-widest ${player.ready ? "text-ready" : "text-muted-dim"}`}>
            {player.ready ? "Ready" : "Not ready"}
          </span>
        ) : null}
      </div>
      <Link href={`/u/${player.handle}`} className="truncate text-sm font-medium hover:underline">
        {player.displayName}
      </Link>
      {racing ? (
        <>
          <div
            className="flex gap-1"
            role="img"
            aria-label={`${STAGE_LABELS[shownStage]}, stage ${shownStage} of ${RACE_STAGES}`}
            data-testid="race-progress"
            data-stage={shownStage}
          >
            {Array.from({ length: RACE_STAGES }, (_, i) => (
              <span key={i} className={`h-1.5 flex-1 rounded-full ${i < shownStage ? "bg-ready" : "bg-surface-hi"}`} />
            ))}
          </div>
          <span className="text-xs text-muted">
            {player.result
              ? player.result.penalty === "DNF"
                ? "DNF"
                : `${formatMs(player.result.durationMs)}${player.result.penalty === "PLUS2" ? " (+2)" : ""}`
              : `${STAGE_LABELS[shownStage]} · ${shownTurns} turns`}
          </span>
        </>
      ) : null}
    </div>
  );
}

function Result({
  view,
  seated,
  busy,
  onRematch,
}: {
  view: View;
  seated: RaceSeat | null;
  busy: boolean;
  onRematch: () => void;
}) {
  const headline =
    view.winner === "draw"
      ? "A draw"
      : seated
        ? view.winner === seated
          ? "You won"
          : "You lost"
        : `${(view.winner === "host" ? view.host : view.guest)?.displayName ?? ""} won`;
  const tone = seated && view.winner === seated ? "text-ready" : seated && view.winner !== "draw" ? "text-danger" : "text-foreground";
  return (
    <div className="flex w-full max-w-md flex-col items-center gap-4 rounded-xl border border-border px-6 py-6 text-center" data-testid="race-result">
      <p className={`text-xl font-medium tracking-tight ${tone}`}>{headline}</p>
      {seated ? (
        <button
          type="button"
          disabled={busy}
          onClick={onRematch}
          className="btn-go px-5 py-2 text-sm disabled:opacity-50"
        >
          {view.rematchCode ? "Join the rematch" : "Rematch"}
        </button>
      ) : (
        <Link href="/race" className="text-sm underline underline-offset-4">
          Start a race of your own
        </Link>
      )}
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col">
      <SiteHeader active="race" />
      <div className="flex flex-1 flex-col items-center gap-6 px-6 pb-16 pt-4">{children}</div>
    </main>
  );
}
