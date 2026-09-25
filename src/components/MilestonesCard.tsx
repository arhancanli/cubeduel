"use client";

import { useEffect, useState } from "react";

import { formatMs } from "@/lib/format";
import {
  KINDS,
  fromHistory,
  milestoneName,
  milestones,
  rungName,
  tally,
  type Earned,
  type Kind,
  type TrackProgress,
} from "@/lib/milestones";
import { loadHistory } from "@/lib/solveHistory";

const KIND_LABEL: Record<Kind, string> = { single: "single", ao5: "ao5", ao12: "ao12" };
const KIND_NAME: Record<Kind, string> = { single: "single", ao5: "average of 5", ao12: "average of 12" };
/** Untouched barriers shown above the last one with anything broken. */
const AHEAD_SHOWN = 1;

/**
 * The barriers cubers talk about — sub-30, sub-20, sub-10 — as a ladder, each
 * rung lit three ways: a single, an ao5, an ao12. Read from this device's
 * history, so it works signed out, and derived rather than stored, so it is
 * always exactly what the solves say.
 *
 * It leads with the one rung worth chasing next and how far away it is; the
 * rest of the ladder is there to show how far you have come.
 */
export function MilestonesCard() {
  const [ladders, setLadders] = useState<TrackProgress[] | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const history = loadHistory();
      const found = milestones(fromHistory(history));
      setLadders(found);
      // Open on the puzzle solved most recently: that is the one being practised.
      const latest = history.reduce<(typeof history)[number] | null>((a, b) => (a === null || b.at > a.at ? b : a), null);
      const hand = latest?.source === "keyboard" ? "keyboard" : "cube";
      setChosen(found.find((l) => l.track.event === (latest?.event ?? "333") && l.track.hand === hand)?.track.key ?? null);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  if (ladders === null) return <div className="h-72 animate-pulse rounded-2xl bg-surface" />;
  if (ladders.length === 0) return null;

  const ladder = ladders.find((l) => l.track.key === chosen) ?? ladders[0];
  const { earned, total } = tally(ladder);

  return (
    <section
      id="milestones"
      data-testid="milestones"
      className="flex scroll-mt-24 flex-col gap-5 rounded-2xl border border-border bg-surface p-5 sm:p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-dim">
            Milestones · <span className="tnum">{earned}</span> of {total}
          </p>
          <Headline ladder={ladder} />
        </div>
        {ladders.length > 1 ? (
          <div role="group" aria-label="Puzzle" className="flex flex-wrap gap-1.5">
            {ladders.map((l) => (
              <button
                key={l.track.key}
                type="button"
                aria-pressed={l.track.key === ladder.track.key}
                onClick={() => setChosen(l.track.key)}
                className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
                  l.track.key === ladder.track.key
                    ? "border-foreground/40 bg-surface-hi text-foreground"
                    : "border-border text-muted hover:border-muted-dim hover:text-foreground"
                }`}
              >
                {l.track.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <Ladder ladder={ladder} />
    </section>
  );
}

/**
 * The barrier worth chasing next: of the longest average you have, since an
 * ao12 under 20 is what "sub-20" means — the single's next barrier until then.
 */
function headlineKind(ladder: TrackProgress): Kind | undefined {
  return [...KINDS].reverse().find((k) => ladder.best[k] !== null && ladder.next[k] !== null);
}

function Headline({ ladder }: { ladder: TrackProgress }) {
  const kind = headlineKind(ladder);
  if (kind === undefined) {
    // Every barrier your results reach is broken. What is left is an average
    // you have not done yet — or nothing at all.
    const missing = KINDS.find((k) => ladder.best[k] === null);
    if (missing === undefined) {
      return <p className="font-display text-2xl font-extrabold tracking-tight">Every barrier broken.</p>;
    }
    const size = missing === "ao5" ? 5 : 12;
    const more = size - ladder.solveCount;
    return (
      <>
        <p className="font-display text-2xl font-extrabold tracking-tight">Next: your first {KIND_NAME[missing]}</p>
        <p className="text-sm text-muted">
          {more > 0
            ? `${more} more solve${more === 1 ? "" : "s"} and it counts.`
            : `Your last ${size} need no more than ${size <= 12 ? "one DNF" : "a few DNFs"} to count.`}
        </p>
      </>
    );
  }
  const next = ladder.next[kind]!;
  const best = ladder.best[kind]!;
  return (
    <>
      <p className="text-balance font-display text-xl font-extrabold tracking-tight sm:text-2xl">Next: {milestoneName(next.underMs, kind)}</p>
      <p className="text-sm text-muted">
        Your best {kind === "single" ? "single" : KIND_LABEL[kind]} is <span className="tnum">{formatMs(best)}</span>
        {next.gapMs === 0 ? " — exactly on it; a hundredth faster breaks it." : (
          <>
            {" — "}
            <span className="tnum">{formatMs(next.gapMs!, { truncate: false })}</span> to go.
          </>
        )}
      </p>
    </>
  );
}

function Ladder({ ladder }: { ladder: TrackProgress }) {
  // Fastest at the top, like a ladder you climb. Shown: the first untouched
  // barrier and one beyond it, everything partly broken, and the fastest one
  // broken all three ways. Slower barriers broken all three ways are long
  // behind you and fold into one line; so do the ones far ahead. "Next" marks
  // the same barrier the headline names.
  const untouched = ladder.rungs.findIndex((r) => KINDS.every((k) => r[k] === null));
  const lastShown = untouched === -1 ? ladder.rungs.length - 1 : Math.min(ladder.rungs.length - 1, untouched + AHEAD_SHOWN);
  const complete = ladder.rungs.findIndex((r) => KINDS.some((k) => r[k] === null));
  const completeCount = complete === -1 ? ladder.rungs.length : complete;
  const folded = completeCount >= 3 ? ladder.rungs.slice(0, completeCount - 1) : [];
  const kind = headlineKind(ladder) ?? "single";
  const nextUnder = ladder.next[kind]?.underMs ?? null;
  const shown = ladder.rungs.slice(folded.length, lastShown + 1).reverse();
  const hidden = ladder.rungs.length - 1 - lastShown;
  const fastest = ladder.rungs[ladder.rungs.length - 1];

  return (
    <div className="flex flex-col">
      {hidden > 0 ? (
        <p className="pb-2 text-xs text-muted-dim">
          {hidden} more above, up to {rungName(fastest.underMs).toLowerCase()}.
        </p>
      ) : null}
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 border-b border-border pb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-dim sm:grid-cols-[8rem_auto_minmax(0,1fr)]">
        <span>Barrier</span>
        <span className="grid grid-cols-3 gap-1.5 text-center">
          {KINDS.map((k) => (
            <span key={k} className="w-9">{KIND_LABEL[k]}</span>
          ))}
        </span>
        <span className="hidden sm:block">Latest</span>
      </div>
      <ol>
        {shown.map((rung) => {
          const isNext = rung.underMs === nextUnder;
          const latest = KINDS.map((k) => rung[k]).filter((e): e is Earned => e !== null).sort((a, b) => b.at - a.at)[0];
          return (
            <li
              key={rung.underMs}
              data-testid="rung"
              data-next={isNext || undefined}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 border-b border-border/60 py-2.5 last:border-b-0 sm:grid-cols-[8rem_auto_minmax(0,1fr)]"
            >
              <span className={`flex items-center gap-2 text-[15px] font-semibold ${latest || isNext ? "text-foreground" : "text-muted-dim"}`}>
                {rungName(rung.underMs)}
                {isNext ? (
                  <span className="rounded-md border border-go/40 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-go">
                    next
                  </span>
                ) : null}
              </span>
              <span className="grid grid-cols-3 gap-1.5">
                {KINDS.map((k) => {
                  const e = rung[k];
                  return (
                    <span key={k} className="grid w-9 place-items-center">
                      <span
                        role="img"
                        aria-label={`${milestoneName(rung.underMs, k)}: ${e ? `${formatMs(e.resultMs)} on ${day(e.at)}` : "not yet"}`}
                        title={e ? `${formatMs(e.resultMs)} · ${day(e.at)}` : undefined}
                        data-earned={e ? "" : undefined}
                        className={`size-5 rounded-[5px] ${e ? "bg-go" : isNext && k === kind ? "border border-dashed border-go" : "bg-surface-hi"}`}
                      />
                    </span>
                  );
                })}
              </span>
              {latest ? (
                <span className="col-span-2 truncate pt-1 text-xs text-muted-dim sm:col-span-1 sm:pt-0">
                  {KIND_LABEL[latest.kind]} <span className="tnum text-muted">{formatMs(latest.resultMs)}</span> · {day(latest.at)}
                </span>
              ) : (
                <span className="hidden sm:block" />
              )}
            </li>
          );
        })}
      </ol>
      {folded.length > 0 ? (
        <p data-testid="rungs-folded" className="flex items-center gap-2 border-t border-border/60 pt-2.5 text-xs text-muted-dim">
          <span aria-hidden="true" className="size-2 shrink-0 rounded-[3px] bg-go" />
          {listed(folded.map((r) => rungName(r.underMs).toLowerCase()).reverse())}: all broken, all three ways.
        </p>
      ) : null}
    </div>
  );
}

/** "sub-30, sub-45 and sub-1 minute", capitalised. */
function listed(names: string[]): string {
  const text = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function day(at: number): string {
  const d = new Date(at);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) });
}
