"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";

import { CubeView } from "@/components/CubeView";
import { InspectionCountdown } from "@/components/InspectionCountdown";
import { MovePad } from "@/components/MovePad";
import { KeyboardCard, ModeLayout, ScrambleCard, SideCard } from "@/components/ModeLayout";
import { SiteHeader } from "@/components/SiteHeader";
import { WeeklyBoardTable } from "@/components/WeeklyBoardTable";
import { formatMs } from "@/lib/format";
import { INSPECTION_LIMIT_MS } from "@/lib/inspection";
import { trimmedAverage, effectiveMs } from "@/lib/stats";
import type { Penalty } from "@/lib/types";
import { useSolveSession } from "@/lib/useSolveSession";
import { WEEKLY_ATTEMPTS, type Placed } from "@/lib/weekly";

/** Five stickers lit — the five attempts. */
const WEEKLY_GLYPH = "101010101";

interface Result {
  idx: number;
  durationMs: number;
  penalty: Penalty;
}

export interface WeeklyProps {
  week: string;
  label: string;
  closesAt: number;
  signedIn: boolean;
  you: string | null;
  results: Result[];
  /** An attempt left open on an earlier visit: starting again records it as a DNF. */
  leftOpen: number | null;
  placed: Placed[];
  competing: number;
  lastWeek: string | null;
}

/**
 * The weekly. Five scrambles, the same for everybody, one attempt at each —
 * every one of them played under ranked's rules, which the page states before
 * the first is opened rather than after the first is lost.
 */
export function WeeklyScreen(props: WeeklyProps) {
  const router = useRouter();
  const [results, setResults] = useState<Result[]>(props.results);
  const [leftOpen, setLeftOpen] = useState(props.leftOpen);
  const [rejection, setRejection] = useState<string | null>(null);
  const [verdict, setVerdict] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [started, setStarted] = useState(false);
  const attemptRef = useRef<{ id: string; idx: number } | null>(null);
  const submittedRef = useRef(false);

  const done = results.length;
  const finished = done >= WEEKLY_ATTEMPTS;

  const supplyScramble = useCallback(async () => {
    setStarted(true);
    setRejection(null);
    setVerdict(null);
    submittedRef.current = false;
    attemptRef.current = null;
    const response = await fetch("/api/weekly/attempt", { method: "POST" });
    const body = (await response.json().catch(() => null)) as
      | { attemptId?: string; idx?: number; scramble?: string; error?: string }
      | null;
    if (!response.ok || !body?.attemptId || typeof body.idx !== "number" || !body.scramble) {
      throw new Error(body?.error ?? "Could not open the attempt.");
    }
    // The one left open on an earlier visit is now a DNF, and says so.
    if (leftOpen !== null) {
      setResults((list) => (list.some((r) => r.idx === leftOpen) ? list : [...list, { idx: leftOpen, durationMs: 0, penalty: "DNF" }]));
      setLeftOpen(null);
    }
    attemptRef.current = { id: body.attemptId, idx: body.idx };
    return body.scramble;
  }, [leftOpen]);

  const session = useSolveSession({
    nextScramble: supplyScramble,
    autoStart: false,
    onRoundError: (message) => setRejection(message),
    onSolved: ({ recording, source }) => {
      const attempt = attemptRef.current;
      if (!attempt || submittedRef.current) return;
      submittedRef.current = true;
      setSubmitting(true);
      void fetch("/api/weekly/submit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          attemptId: attempt.id,
          clientId: `wk_${attempt.id}`,
          durationMs: recording.durationMs,
          penalty: "OK",
          source,
          moves: recording.moves.map((m) => ({ move: m.move, atMs: m.atMs })),
        }),
      })
        .then(async (response) => {
          const body = (await response.json().catch(() => null)) as
            | { accepted?: boolean; reason?: string; durationMs?: number; penalty?: Penalty; inspectionReason?: string; done?: number }
            | null;
          if (!response.ok || !body?.accepted) {
            // Spent either way: a rejected solve is a DNF on this scramble.
            setResults((list) => [...list, { idx: attempt.idx, durationMs: 0, penalty: "DNF" }]);
            setRejection(body?.reason ?? "That solve could not be verified, so it counts as a DNF.");
            return;
          }
          setVerdict(body.inspectionReason || null);
          setResults((list) => [...list, { idx: attempt.idx, durationMs: body.durationMs ?? recording.durationMs, penalty: body.penalty ?? "OK" }]);
          // With the fifth in, the board has you on it.
          if ((body.done ?? 0) >= WEEKLY_ATTEMPTS) router.refresh();
        })
        .catch(() => setRejection("Could not reach the server. That solve was not counted."))
        .finally(() => setSubmitting(false));
    },
  });

  const { scramble, phase, moveCount, activeKey, displayRef, connectError } = session;
  const solving = phase === "running";
  const average = finished ? trimmedAverage(results.map((r) => ({ ms: r.durationMs, penalty: r.penalty })), WEEKLY_ATTEMPTS) : null;
  const yourPlace = props.placed.find((p) => p.handle === props.you) ?? null;

  return (
    <main className="flex min-h-dvh flex-col">
      <SiteHeader active="weekly" />
      <ModeLayout
        face="ranked"
        glyph={WEEKLY_GLYPH}
        title="Weekly"
        blurb={`Five scrambles for everyone · ${props.label}`}
        dim={solving}
        aside={
          <>
            <SideCard title="How the weekly works">
              <ul className="flex list-disc flex-col gap-1.5 pl-4 text-sm leading-relaxed text-muted">
                <li>Everyone gets the same five scrambles this week. Each one is shown only when you open it.</li>
                <li>One attempt at each. Your result is the WCA average of five: best and worst dropped.</li>
                <li>
                  Every solve is checked like ranked: the server replays your turns, and inspection is{" "}
                  {INSPECTION_LIMIT_MS / 1000} seconds from the moment the scramble appears.
                </li>
                <li>Opening the next one before finishing this one records it as a DNF.</li>
                <li>Results close {closesText(props.closesAt)}. Then the scrambles and every solve are published.</li>
              </ul>
            </SideCard>
            <KeyboardCard activeKey={activeKey} />
          </>
        }
      >
        <Attempts results={results} current={started && !finished && phase !== "idle" ? attemptRef.current?.idx ?? done : null} />

        {!props.signedIn ? (
          <div className="flex flex-col items-center gap-3 text-center">
            <p className="max-w-md text-sm text-muted">A result has to belong to someone, so the weekly needs an account. The board below is open to everyone.</p>
            <Link href="/sign-in?next=/weekly" className="btn-go px-6 py-3 text-[15px]">
              Sign in to enter
            </Link>
          </div>
        ) : finished ? (
          <div data-testid="weekly-finished" className="flex flex-col items-center gap-1 text-center">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-dim">Your average</p>
            <p className="tnum font-display text-5xl font-extrabold">
              {average?.kind === "value" ? formatMs(average.ms, { truncate: false }) : "DNF"}
            </p>
            <p className="text-sm text-muted">
              {yourPlace ? `${ordinal(yourPlace.place)} of ${props.placed.length} so far.` : "Placing you on the board…"} The week closes {closesText(props.closesAt)}.
            </p>
          </div>
        ) : (
          <>
            <ScrambleCard
              scramble={scramble}
              dim={solving}
              label={`Scramble ${Math.min(done + 1, WEEKLY_ATTEMPTS)} of ${WEEKLY_ATTEMPTS} · already applied`}
              placeholder="The scramble appears when you open the attempt."
            />
            <CubeView scramble={scramble} interactive onPlayerReady={session.onPlayerReady} className="h-[26vh] max-h-72 min-h-40 w-full max-w-md" />
            <div className="flex flex-col items-center gap-2">
              <div
                ref={displayRef}
                className={`tnum font-display text-6xl font-bold leading-none tracking-tighter sm:text-7xl ${phase === "solved" ? "text-ready" : "text-foreground"}`}
              >
                0.00
              </div>
              <InspectionCountdown active={phase === "armed"} />
              <p className="text-sm text-muted">
                {phase === "armed" && "Attempt open — the first turn starts the clock."}
                {phase === "running" && `${moveCount} moves`}
                {phase === "solved" && (submitting ? "Checking your solve…" : "Recorded.")}
                {phase === "idle" && (started ? "Opening the attempt…" : "Nothing is counted until you open an attempt.")}
              </p>
            </div>
            {leftOpen !== null && !started ? (
              <p className="max-w-md text-center text-xs text-holding">
                Attempt {leftOpen + 1} was opened and not finished. Opening the next one records it as a DNF.
              </p>
            ) : null}
            {verdict ? <p className="max-w-md text-center text-xs text-holding">{verdict}</p> : null}
            {rejection ? (
              <p role="alert" className="max-w-md rounded-lg border border-danger/40 bg-danger/5 px-4 py-3 text-center text-xs text-danger">
                {rejection}
              </p>
            ) : null}
            <button
              type="button"
              onClick={() => void session.startRound()}
              disabled={submitting || solving || phase === "armed"}
              className="btn-go px-6 py-3 text-[15px] disabled:opacity-40"
            >
              {`Open attempt ${Math.min(done + (leftOpen !== null && !started ? 2 : 1), WEEKLY_ATTEMPTS)} of ${WEEKLY_ATTEMPTS}`}
            </button>
            {connectError ? <p className="max-w-md text-center text-xs text-danger">{connectError}</p> : null}
            <MovePad onMove={session.pushMove} className="md:hidden" />
          </>
        )}

        <section className="w-full">
          <header className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-lg tracking-tight">This week</h2>
            <p className="text-xs text-muted-dim">
              {props.placed.length} finished{props.competing > 0 ? ` · ${props.competing} still going` : ""}
            </p>
          </header>
          {props.placed.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-border px-5 py-8 text-center text-sm text-muted">
              Nobody has finished all five yet this week.
            </p>
          ) : (
            <WeeklyBoardTable placed={props.placed} you={props.you} />
          )}
          {props.lastWeek ? (
            <Link href={`/weekly/${props.lastWeek}`} className="mt-3 inline-block text-sm text-muted hover:text-foreground">
              Last week&apos;s results and scrambles →
            </Link>
          ) : null}
        </section>
      </ModeLayout>
    </main>
  );
}

/** Five boxes: a time, a DNF, or an empty slot; the one being played outlined. */
function Attempts({ results, current }: { results: Result[]; current: number | null }) {
  const byIdx = new Map(results.map((r) => [r.idx, r]));
  return (
    <ol aria-label="Your five attempts" className="grid w-full max-w-md grid-cols-5 gap-2" data-testid="weekly-attempts">
      {Array.from({ length: WEEKLY_ATTEMPTS }, (_, i) => {
        const r = byIdx.get(i);
        const ms = r ? effectiveMs(r.penalty === "DNF" ? { ms: 0, penalty: "DNF" } : { ms: r.durationMs, penalty: r.penalty }) : null;
        return (
          <li
            key={i}
            className={`flex flex-col items-center rounded-xl border px-1 py-2 ${
              i === current ? "border-go" : r ? "border-border bg-surface" : "border-dashed border-border"
            }`}
          >
            <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-dim">{i + 1}</span>
            <span className="tnum text-sm font-semibold">{r ? (ms === null ? "DNF" : formatMs(ms)) : "–"}</span>
          </li>
        );
      })}
    </ol>
  );
}

function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `${n}${s}`;
}

function closesText(at: number): string {
  const d = new Date(at);
  return `${d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short", timeZone: "UTC" })} at 00:00 UTC`;
}
