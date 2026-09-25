import Link from "next/link";

import { formatMs } from "@/lib/format";
import { KINDS, rungName, type Earned, type Kind, type TrackProgress } from "@/lib/milestones";
import type { Proof } from "@/lib/server/profileMilestones";

const KIND_LABEL: Record<Kind, string> = { single: "single", ao5: "ao5", ao12: "ao12" };

/**
 * The fastest barrier a player has broken, per puzzle and per kind, each one a
 * link to the solve that broke it. For an average that is the solve completing
 * the window. "Verified" means the server replayed its turns; "practice" was
 * turned here but never replayed; "self-timed" is a stopwatch time.
 */
export function ProfileMilestones({ ladders, proof }: { ladders: TrackProgress[]; proof: Map<string, Proof> }) {
  if (ladders.length === 0) return null;
  return (
    <section data-testid="profile-milestones">
      <h2 className="mb-3 text-lg">Milestones</h2>
      <div className="flex flex-col gap-3">
        {ladders.map((ladder) => (
          <div key={ladder.track.key} className="rounded-2xl border border-border bg-surface p-4 sm:p-5">
            <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-dim">{ladder.track.label}</p>
            <ul className="grid grid-cols-3 gap-2 sm:gap-3">
              {KINDS.map((kind) => {
                const top = fastest(ladder, kind);
                const shown = top ? (proof.get(top.solveId) ?? "practice") : null;
                return (
                  <li key={kind} data-kind={kind}>
                    {top ? (
                      <Link
                        href={`/s/${top.solveId}`}
                        aria-label={`${rungName(top.underMs)} ${KIND_LABEL[kind]}: ${formatMs(top.resultMs)}${shown === "verified" ? ", verified" : ""}`}
                        className="flex h-full flex-col gap-0.5 rounded-xl border border-border bg-surface-hi/60 px-3 py-2.5 transition-colors hover:border-muted-dim"
                      >
                        <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-dim">{KIND_LABEL[kind]}</span>
                        <span className="font-display text-lg font-extrabold leading-tight sm:text-xl">{rungName(top.underMs)}</span>
                        <span className="tnum text-xs text-muted">{formatMs(top.resultMs)}</span>
                        <span data-proof={shown} className={`text-[11px] ${shown === "verified" ? "text-go" : "text-muted-dim"}`}>
                          {shown === "verified" ? "✓ verified" : shown}
                        </span>
                      </Link>
                    ) : (
                      <div className="flex h-full flex-col gap-0.5 rounded-xl border border-dashed border-border px-3 py-2.5">
                        <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-dim">{KIND_LABEL[kind]}</span>
                        <span className="text-sm text-muted-dim">none yet</span>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

function fastest(ladder: TrackProgress, kind: Kind): Earned | null {
  for (let i = ladder.rungs.length - 1; i >= 0; i--) {
    const earned = ladder.rungs[i][kind];
    if (earned) return earned;
  }
  return null;
}
