"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { SolveBreakdown } from "@/components/SolveBreakdown";
import { SolveReplay, type ReplayControl } from "@/components/SolveReplay";
import type { TimedMove } from "@/lib/cfop";
import { formatMs } from "@/lib/format";
import type { Moment } from "@/lib/moveReview";
import { crossFaceLabel, studySolve, type SolveStudy as Study } from "@/lib/solveStudy";

/**
 * A solve, reviewed: the replay on one side, the moments worth stopping the tape
 * at on the other. Choosing a moment plays the replay from just before it.
 *
 * The review is worked out in the browser from the turns alone, so it is the
 * same for a solve kept on this device as for one on the ladder.
 */
export function SolveStudy({
  scramble,
  moves,
  durationMs,
  showBreakdown = true,
}: {
  scramble: string;
  moves: TimedMove[];
  durationMs: number;
  showBreakdown?: boolean;
}) {
  const [study, setStudy] = useState<Study | null>(null);
  const [failed, setFailed] = useState(false);
  const replay = useRef<ReplayControl>(null);
  const replayBox = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    studySolve(scramble, moves, durationMs)
      .then((result) => {
        if (!cancelled) setStudy(result);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [scramble, moves, durationMs]);

  if (failed) {
    return (
      <p className="rounded-2xl border border-border bg-surface px-5 py-6 text-sm text-muted">
        This solve could not be read back. The time stands; the review needs the turns to replay cleanly.
      </p>
    );
  }

  if (!study) {
    return (
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]" aria-busy="true">
        <div className="aspect-square w-full animate-pulse rounded-3xl bg-surface" />
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-dim">Reading the solve…</p>
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-20 animate-pulse rounded-2xl bg-surface" />
          ))}
        </div>
      </div>
    );
  }

  const { review, analysis, cross } = study;
  const costs = review.moments.filter((m) => m.tone === "cost");
  const share = durationMs > 0 ? review.recoverableMs / durationMs : 0;
  const crossPhase = analysis.splits.find((s) => s.phase === "Cross");

  const watch = (moment: Moment) => {
    replay.current?.watch(moment.atMs);
    // On a phone the replay is above the list; bring it back into view.
    if (window.matchMedia("(max-width: 1023.98px)").matches) {
      replayBox.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  return (
    <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <div ref={replayBox} className="flex flex-col gap-6 lg:sticky lg:top-6">
        <SolveReplay
          scramble={scramble}
          moves={moves}
          splits={analysis.splits}
          durationMs={durationMs}
          controlRef={replay}
        />
      </div>

      <section aria-labelledby="review-heading" className="flex flex-col gap-6">
        <div className="flex flex-col gap-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-sticker-green">Review</p>
          <h2 id="review-heading" className="text-3xl">
            {costs.length === 0 ? "A clean solve." : `${costs.length} moment${costs.length === 1 ? "" : "s"} worth a look`}
          </h2>
        </div>

        <dl className="grid grid-cols-3 gap-2">
          <Tile label="Time" value={formatMs(durationMs, { truncate: false })} />
          <Tile
            label="Turns"
            value={String(review.turns)}
            note={durationMs > 0 ? `${((review.turns / durationMs) * 1000).toFixed(1)} per second` : undefined}
          />
          <Tile
            label="Recoverable"
            value={review.recoverableMs > 0 ? `~${formatMs(review.recoverableMs, { truncate: false })}` : "—"}
            note={review.recoverableMs > 0 ? `${Math.round(share * 100)}% of the solve` : "nothing found"}
          />
        </dl>

        {review.moments.length > 0 ? (
          <ol className="flex flex-col gap-2" data-testid="review-moments">
            {review.moments.map((moment, i) => (
              <li key={`${moment.kind}-${moment.atMs}-${i}`}>
                <MomentRow moment={moment} onWatch={() => watch(moment)} />
              </li>
            ))}
          </ol>
        ) : (
          <p className="rounded-2xl border border-border bg-surface px-5 py-5 text-sm leading-relaxed text-muted">
            Nothing to stop the tape for: no long pauses, no turns undone, no detours.
          </p>
        )}

        {cross && crossPhase ? (
          <p className="text-xs leading-relaxed text-muted-dim">
            Built as a {crossFaceLabel(cross.face)}. The shortest cross on that face was {cross.moves} turn
            {cross.moves === 1 ? "" : "s"}.
          </p>
        ) : null}

        {showBreakdown && analysis.splits.length > 0 ? <SolveBreakdown splits={analysis.splits} /> : null}

        <p className="text-xs leading-relaxed text-muted-dim">
          Every cost is priced at your own pace in that part of the solve — nothing here compares you with
          anybody else. &ldquo;Recoverable&rdquo; includes some thinking every solve needs, so it is a ceiling,
          not a promise.
        </p>
      </section>
    </div>
  );
}

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface px-3.5 py-3">
      <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-dim">{label}</dt>
      <dd className="tnum mt-1 font-display text-xl font-bold">{value}</dd>
      {note ? <dd className="mt-0.5 text-[11px] text-muted-dim">{note}</dd> : null}
    </div>
  );
}

function MomentRow({ moment, onWatch }: { moment: Moment; onWatch: () => void }) {
  const good = moment.tone === "good";
  const big = !good && moment.costMs >= 1000;
  const colour = good ? "var(--ready)" : big ? "var(--danger)" : "var(--holding)";
  return (
    <div className="group relative flex gap-3 rounded-2xl border border-border bg-surface p-4 transition-colors hover:border-muted-dim/60">
      <span aria-hidden="true" className="mt-1.5 size-2.5 shrink-0 rounded-full" style={{ background: colour }} />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-[15px] font-semibold leading-snug">{moment.title}</p>
          {!good && moment.costMs >= 50 ? (
            <span className="tnum shrink-0 text-sm font-semibold" style={{ color: colour }}>
              −{formatMs(moment.costMs, { truncate: false })}
            </span>
          ) : null}
        </div>
        <p className="text-sm leading-relaxed text-muted">{moment.detail}</p>
        {moment.alg ? (
          <p className="font-mono text-sm tracking-wide text-foreground">
            <span className="mr-2 text-xs text-muted-dim">shortest</span>
            {moment.alg}
          </p>
        ) : null}
        <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          <span className="rounded-md bg-surface-hi px-1.5 py-0.5 text-muted-dim">{moment.phase}</span>
          <span className="tnum text-muted-dim">at {formatMs(moment.atMs, { truncate: false })}</span>
          <button
            type="button"
            onClick={onWatch}
            className="font-semibold text-foreground underline decoration-border underline-offset-4 hover:decoration-current"
          >
            Watch it
          </button>
          {moment.href ? (
            <Link
              href={moment.href}
              className="font-semibold text-sticker-green underline decoration-transparent underline-offset-4 hover:decoration-current"
            >
              Learn this case →
            </Link>
          ) : null}
        </div>
      </div>
    </div>
  );
}
