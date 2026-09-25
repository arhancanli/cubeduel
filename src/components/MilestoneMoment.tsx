"use client";

import Link from "next/link";
import { useMemo } from "react";

import { formatMs } from "@/lib/format";
import { barrierPhrase, earnedBy, fromHistory, milestoneName, milestones, type Earned, type Track } from "@/lib/milestones";
import { loadHistory } from "@/lib/solveHistory";
import type { Penalty } from "@/lib/types";

/**
 * The moment a solve breaks a barrier — "first sub-20 ever" — said right under
 * the time, where the player is already looking.
 *
 * Read from the saved history every time rather than remembered, so a +2 or a
 * DNF added a second later takes it straight back: `penalty` is here only so a
 * change to it re-reads.
 */
export function MilestoneMoment({ solveId, penalty }: { solveId: string; penalty: Penalty }) {
  const earned = useMemo(() => {
    void penalty;
    return earnedBy(milestones(fromHistory(loadHistory())), solveId);
  }, [solveId, penalty]);

  if (earned.length === 0) return null;

  return (
    <div
      role="status"
      data-testid="milestone-moment"
      className="flex w-full max-w-md flex-col gap-2 rounded-2xl border border-go/40 bg-go/10 px-5 py-4 text-left"
    >
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-go">
        New milestone{earned.length > 1 ? "s" : ""}
      </p>
      <ul className="flex flex-col gap-1.5">
        {earned.map((e) => (
          <li key={e.kind} className="flex flex-col">
            <span className="font-display text-xl font-extrabold tracking-tight">{milestoneName(e.underMs, e.kind)}</span>
            <span className="text-sm text-muted">{sentence(e, e.track)}</span>
          </li>
        ))}
      </ul>
      <Link href="/progress#milestones" className="self-start text-sm font-semibold text-go hover:underline">
        Your milestones →
      </Link>
    </div>
  );
}

function sentence(e: Earned, track: Track): string {
  const what = e.kind === "single" ? "solve" : e.kind === "ao5" ? "average of 5" : "average of 12";
  return `${formatMs(e.resultMs)} — your first ${what} under ${barrierPhrase(e.underMs)} ${track.where}.`;
}
