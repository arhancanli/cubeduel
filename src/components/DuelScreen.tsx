"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { CubeView } from "@/components/CubeView";
import {
  ChallengePanel,
  type ChallengeItem,
  type OpenChallengeItem,
} from "@/components/ChallengePanel";
import { MovePad } from "@/components/MovePad";
import { KeyMapHint } from "@/components/KeyMapHint";
import { SiteHeader } from "@/components/SiteHeader";
import { BOTS, botProgressAt, type BotProfile } from "@/lib/bot";
import { formatMs } from "@/lib/format";
import { msForRating } from "@/lib/rating";
import { useLatest } from "@/lib/useLatest";
import { useSolveSession } from "@/lib/useSolveSession";

/**
 * The race.
 *
 * The opponent's entire trajectory arrives with the scramble, because it was
 * committed to the database before the duel started. So the bar below is not an
 * estimate or an animation on a timer — it is the actual move stream the bot is
 * playing, rendered locally, and the bot could not have changed it after seeing
 * how the player was doing.
 *
 * That is also why there is no polling here: the race needs no live channel,
 * because the opponent's side of it is already known and cannot move.
 */

interface BotMove {
  move: string;
  atMs: number;
}

interface DuelStartResponse {
  duelId: string;
  scramble: string;
  bot: BotProfile;
  botMoves: BotMove[];
  botDurationMs: number;
}

interface DuelFinishResponse {
  accepted?: boolean;
  reason?: string;
  outcome?: "win" | "loss";
  playerDurationMs?: number;
  botDurationMs?: number;
  marginMs?: number;
}

export function DuelScreen({
  record,
  challenges,
  openChallenges,
}: {
  record: { wins: number; losses: number };
  challenges: ChallengeItem[];
  openChallenges: OpenChallengeItem[];
}) {
  const [opponent, setOpponent] = useState<BotProfile>(BOTS[2]);
  const [duel, setDuel] = useState<DuelStartResponse | null>(null);
  const [result, setResult] = useState<DuelFinishResponse | null>(null);
  const [rejection, setRejection] = useState<string | null>(null);
  const [tally, setTally] = useState(record);
  const [botAt, setBotAt] = useState(0);

  const duelRef = useRef<DuelStartResponse | null>(null);
  const submittedRef = useRef(false);
  // Read inside a mount-stable callback, so it goes through `useLatest` rather
  // than being written during render.
  const opponentRef = useLatest(opponent);

  const supplyScramble = useCallback(async () => {
    setRejection(null);
    setResult(null);
    setBotAt(0);
    submittedRef.current = false;

    const response = await fetch("/api/duel/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ botId: opponentRef.current.id }),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new Error(body?.error ?? "Could not start the duel.");
    }

    const started = (await response.json()) as DuelStartResponse;
    duelRef.current = started;
    setDuel(started);
    return started.scramble;
    // The ref object is stable for the life of the component, so listing it
    // changes nothing at runtime — it only tells the rule what it cannot see
    // through a custom hook.
  }, [opponentRef]);

  const session = useSolveSession({
    nextScramble: supplyScramble,
    // A duel is a commitment: walking away from one is a loss. Nobody starts a
    // race by opening a page.
    autoStart: false,
    onRoundError: (message) => setRejection(message),
    onSolved: ({ recording, analysis, source }) => {
      const current = duelRef.current;
      if (!current || submittedRef.current) return;
      submittedRef.current = true;

      void fetch("/api/duel/finish", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          duelId: current.duelId,
          clientId: `dl_${current.duelId}`,
          durationMs: recording.durationMs,
          penalty: "OK",
          source,
          moves: recording.moves.map((m) => ({ move: m.move, atMs: m.atMs })),
          splits: analysis.splits,
        }),
      })
        .then(async (response) => {
          const body = (await response.json().catch(() => null)) as DuelFinishResponse | null;
          if (!response.ok || !body?.accepted) {
            setRejection(body?.reason ?? "That solve could not be verified.");
            return;
          }
          setResult(body);
          setTally((t) => ({
            wins: t.wins + (body.outcome === "win" ? 1 : 0),
            losses: t.losses + (body.outcome === "loss" ? 1 : 0),
          }));
        })
        .catch(() => setRejection("Could not reach the server. That duel was not recorded."))
    },
  });

  const { scramble, phase, moveCount, connectError, activeKey, displayRef } = session;
  const racing = phase === "running";

  /**
   * The opponent's progress, driven off the same clock the player's timer uses.
   *
   * Only runs while the player is actually solving: the bot starts when they do,
   * which is what makes it a race rather than a countdown that began at page load.
   */
  useEffect(() => {
    if (!racing || !duel) return;
    const startedAt = performance.now();
    let frame = 0;

    const tick = () => {
      const elapsed = performance.now() - startedAt;
      setBotAt(
        botProgressAt(
          { moves: duel.botMoves, durationMs: duel.botDurationMs, tps: 0 },
          elapsed,
        ),
      );
      if (elapsed < duel.botDurationMs) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [racing, duel]);

  const botTotal = duel?.botMoves.length ?? 0;
  const botPct = botTotal > 0 ? Math.min(100, (botAt / botTotal) * 100) : 0;

  return (
    <main className="flex min-h-dvh flex-col">
      <SiteHeader active="duel" />

      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center gap-6 px-6 pb-12">
        {!duel ? (
          <OpponentPicker
            selected={opponent}
            onSelect={setOpponent}
            tally={tally}
            onStart={() => void session.startRound()}
            challenges={challenges}
            openChallenges={openChallenges}
          />
        ) : null}

        {duel ? (
          <>
            <div className="flex w-full items-center justify-between text-xs text-muted-dim">
              <span>
                vs {duel.bot.name} · {duel.bot.rating}
              </span>
              <span className="tnum">
                target {formatMs(duel.botDurationMs, { truncate: false })}
              </span>
            </div>

            <div
              className={`mx-auto flex max-w-5xl flex-wrap items-center justify-center gap-x-3 gap-y-1.5 font-mono text-base leading-snug transition-opacity sm:text-lg ${
                racing ? "opacity-30" : "opacity-100"
              }`}
            >
              {scramble.split(" ").map((move, i) => (
                <span key={`${move}-${i}`}>{move}</span>
              ))}
            </div>

            <CubeView
              scramble={scramble}
              backView="none"
              onPlayerReady={session.onPlayerReady}
              className="h-[24vh] max-h-56 min-h-32 w-full max-w-md"
            />

            <div className="flex flex-col items-center gap-2">
              <div
                ref={displayRef}
                className={`tnum text-6xl font-medium leading-none tracking-tighter transition-colors sm:text-7xl ${
                  result?.outcome === "win"
                    ? "text-ready"
                    : result?.outcome === "loss"
                      ? "text-danger"
                      : "text-foreground"
                }`}
              >
                0.00
              </div>
              <p className="text-xs text-muted-dim">
                {phase === "armed" && "Your first turn starts both clocks."}
                {phase === "running" && `${moveCount} moves`}
                {phase === "solved" && !result && "Verifying…"}
                {phase === "solved" && result && (result.outcome === "win" ? "You won" : "You lost")}
              </p>
            </div>

            <MovePad onMove={session.pushMove} className="md:hidden" />

            {/* The opponent, moving at exactly the pace it committed to. */}
            <div className="w-full max-w-md">
              <div className="mb-1.5 flex items-baseline justify-between text-xs text-muted-dim">
                <span>{duel.bot.name}</span>
                <span className="tnum">
                  {Math.min(botAt, botTotal)}/{botTotal} moves
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-hi">
                <div
                  className="h-full rounded-full bg-bar transition-[width] duration-100 ease-linear"
                  style={{ width: `${botPct}%` }}
                />
              </div>
            </div>

            {result ? <Verdict result={result} /> : null}

            {rejection ? (
              <p className="max-w-md rounded-lg border border-danger/40 bg-danger/5 px-4 py-3 text-center text-xs leading-relaxed text-danger">
                {rejection}
              </p>
            ) : null}

            {phase === "solved" || rejection ? (
              <button
                type="button"
                onClick={() => void session.startRound()}
                className="rounded-lg bg-foreground px-5 py-2.5 text-sm font-medium text-background transition-opacity hover:opacity-90"
              >
                Race again
              </button>
            ) : null}

            {connectError ? (
              <p className="max-w-md text-center text-xs text-danger">{connectError}</p>
            ) : null}

            <p className="max-w-md text-center text-xs leading-relaxed text-muted-dim">
              {duel.bot.name} solves in {duel.botMoves.length} moves, which is far
              fewer than a human method takes — so it turns much more slowly than a
              person would. Its time is honest; its technique is not human.
            </p>

            <div className="mt-2 hidden md:block">
              <KeyMapHint activeCode={activeKey} />
            </div>
          </>
        ) : null}
      </div>
    </main>
  );
}

function OpponentPicker({
  selected,
  onSelect,
  tally,
  onStart,
  challenges,
  openChallenges,
}: {
  selected: BotProfile;
  onSelect: (bot: BotProfile) => void;
  tally: { wins: number; losses: number };
  onStart: () => void;
  challenges: ChallengeItem[];
  openChallenges: OpenChallengeItem[];
}) {
  return (
    <div className="flex w-full flex-col items-center gap-10 pt-4">
      {/* Players first. Racing a person is the better game; the bots are what is
          always available when nobody has answered yet, and putting them at the
          top would say the opposite. */}
      <ChallengePanel initial={challenges} initialOpen={openChallenges} />

      <div className="flex w-full max-w-2xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-medium tracking-tight">Or race a bot</h1>
        <p className="text-sm text-muted">
          Always available, and never a wait. Every bot races the cube you race,
          on a real solution to that exact scramble, at a pace fixed before you
          start.
        </p>
        <p className="text-xs text-muted-dim">
          Your record: {tally.wins}W · {tally.losses}L
        </p>
      </div>

      <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
        {BOTS.map((bot) => (
          <li key={bot.id}>
            <button
              type="button"
              onClick={() => onSelect(bot)}
              className={`flex w-full items-center gap-4 px-4 py-3 text-left transition-colors ${
                selected.id === bot.id ? "bg-surface-hi" : "bg-surface hover:bg-surface-hi"
              }`}
            >
              <span className="flex-1">
                <span className="block text-sm font-medium">{bot.name}</span>
                <span className="block text-xs text-muted-dim">{bot.blurb}</span>
              </span>
              <span className="tnum text-right text-sm text-muted">
                {bot.rating}
                <span className="block text-[11px] text-muted-dim">
                  {formatMs(msForRating(bot.rating), { truncate: false })}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>

      <button
        type="button"
        onClick={onStart}
        className="self-start rounded-lg bg-foreground px-6 py-2.5 text-sm font-medium text-background transition-opacity hover:opacity-90"
      >
        Race {selected.name}
      </button>

      <p className="text-xs leading-relaxed text-muted-dim">
        Starting a duel commits you to it — leaving before you finish is recorded
        as a loss. A duel does not move your rating: how fast you solve does not
        depend on whether somebody is racing you.
      </p>
      </div>
    </div>
  );
}

function Verdict({ result }: { result: DuelFinishResponse }) {
  const won = result.outcome === "win";
  return (
    <div className="flex w-full max-w-md flex-col items-center gap-1 rounded-lg border border-border bg-surface px-5 py-4 text-center">
      <p className={`text-sm font-medium ${won ? "text-ready" : "text-danger"}`}>
        {won ? "You won" : "You lost"} by{" "}
        <span className="tnum">
          {formatMs(result.marginMs ?? 0, { truncate: false })}
        </span>
      </p>
      <p className="tnum text-xs text-muted-dim">
        you {formatMs(result.playerDurationMs ?? 0)} · opponent{" "}
        {formatMs(result.botDurationMs ?? 0)}
      </p>
    </div>
  );
}
