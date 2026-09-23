"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { formatMs } from "@/lib/format";
import { EVENTS, type EventId } from "@/lib/events";
import type { Comparison, WcaRecord } from "@/lib/wca";

/**
 * Somebody's competition results, beside the ones they earned here.
 *
 * The two numbers sit side by side and are never subtracted. A WCA average is
 * five solves on a real cube, in a hall, judged; a keyboard rating is five
 * solves typed. Showing "+3.4s" between them would invite reading a difference
 * in input device as a difference in the cuber — and a site willing to tell
 * somebody their competition average proves they are getting worse online is a
 * site whose numbers nobody should trust.
 *
 * So the panel shows both, says what each measured, and stops.
 */

export interface WcaPanelProps {
  configured: boolean;
  link: {
    wcaId: string;
    name: string | null;
    country: string | null;
    competitions: number | null;
    records: Partial<Record<string, WcaRecord>>;
  } | null;
  /** One per event the person has any number for, on either side. */
  comparisons: { event: EventId; comparison: Comparison }[];
  /** Set when the person has just come back from the WCA. */
  outcome: string | null;
}

const OUTCOMES: Record<string, { tone: "good" | "warn" | "bad"; text: string }> = {
  linked: { tone: "good", text: "Linked. Your competition results are below." },
  cancelled: { tone: "warn", text: "You cancelled at the WCA. Nothing changed." },
  failed: {
    tone: "bad",
    text: "That did not work. Either the request expired, or that WCA profile is already linked to another account.",
  },
  invalid: { tone: "bad", text: "That link was incomplete. Try again." },
  unavailable: { tone: "warn", text: "WCA linking is not configured on this deployment." },
};

export function WcaPanel({ configured, link, comparisons, outcome }: WcaPanelProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const notice = outcome ? OUTCOMES[outcome] : null;

  async function unlink() {
    setBusy(true);
    await fetch("/api/wca/unlink", { method: "POST" });
    setBusy(false);
    router.refresh();
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg">
          World Cube Association
        </h2>
        <p className="max-w-lg text-xs leading-relaxed text-muted-dim">
          Link your WCA profile and your official competition results appear
          beside what you have done here.
        </p>
      </div>

      {notice ? (
        <p
          role="status"
          className={`text-sm ${
            notice.tone === "good"
              ? "text-ready"
              : notice.tone === "warn"
                ? "text-holding"
                : "text-danger"
          }`}
        >
          {notice.text}
        </p>
      ) : null}

      {!configured ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-4 text-xs leading-relaxed text-muted">
          Not available on this deployment. Linking goes through the WCA&rsquo;s own
          sign-in, which needs credentials this instance does not have — and
          there is deliberately no way to type a WCA id in instead. Every WCA id
          is public, so a text field would let anybody attach a world-class
          average to their profile.
        </p>
      ) : !link ? (
        <div className="flex flex-col gap-3">
          <a
            href="/api/wca/start"
            className="self-start rounded-lg border border-border px-5 py-2.5 text-sm transition-colors hover:border-muted-dim"
          >
            Link my WCA profile
          </a>
          <p className="max-w-lg text-xs leading-relaxed text-muted-dim">
            You will sign in at worldcubeassociation.org and come straight back.
            We ask for the narrowest permission there is — enough to know which
            competitor you are, and nothing that would let us act as you.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface px-4 py-3">
            <div className="flex flex-col gap-0.5">
              <a
                href={`https://www.worldcubeassociation.org/persons/${link.wcaId}`}
                className="text-sm underline underline-offset-4 decoration-border transition-colors hover:decoration-current"
              >
                {link.name ?? link.wcaId}
              </a>
              <span className="font-mono text-xs text-muted-dim">
                {link.wcaId}
                {link.country ? ` · ${link.country}` : ""}
                {link.competitions ? ` · ${link.competitions} competitions` : ""}
              </span>
            </div>
            <button
              type="button"
              onClick={unlink}
              disabled={busy}
              className="text-xs text-muted-dim underline underline-offset-4 transition-colors hover:text-danger disabled:opacity-50"
            >
              Unlink
            </button>
          </div>

          {comparisons.length === 0 ? (
            <p className="text-xs leading-relaxed text-muted-dim">
              No results yet for the events this site rates.
            </p>
          ) : (
            <ul className="flex list-none flex-col gap-px overflow-hidden rounded-lg border border-border bg-border p-0">
              {comparisons.map(({ event, comparison }) => (
                <li key={event} className="flex flex-col gap-2 bg-surface px-4 py-3.5">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
                    <span className="text-sm font-medium">{EVENTS[event].name}</span>

                    <span className="flex items-baseline gap-6 font-mono text-sm tabular-nums">
                      <span className="flex flex-col items-end">
                        <span className={comparison.wcaMs === null ? "text-muted-dim" : ""}>
                          {comparison.wcaMs === null ? "—" : formatMs(comparison.wcaMs)}
                        </span>
                        <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-dim">
                          competition
                        </span>
                      </span>

                      <span className="flex flex-col items-end">
                        <span className={comparison.cubeduelMs === null ? "text-muted-dim" : ""}>
                          {comparison.cubeduelMs === null
                            ? "—"
                            : formatMs(comparison.cubeduelMs)}
                        </span>
                        <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-dim">
                          here
                        </span>
                      </span>
                    </span>
                  </div>

                  {/* What the official average is worth on this scale — the
                      thing that makes the two numbers commensurable at all,
                      without pretending they measured the same thing. */}
                  {comparison.wcaAsRating !== null ? (
                    <p className="text-xs text-muted-dim">
                      That competition average is{" "}
                      <span className="font-mono tabular-nums text-muted">
                        {comparison.wcaAsRating}
                      </span>{" "}
                      on this scale.
                    </p>
                  ) : null}

                  <p className="max-w-lg text-xs leading-relaxed text-muted-dim">
                    {comparison.note}
                  </p>
                </li>
              ))}
            </ul>
          )}

          <p className="max-w-lg text-xs leading-relaxed text-muted-dim">
            Nothing here counts toward your rating or any leaderboard. A rating
            on this ladder is earned by solves this server issued a scramble for
            and replayed — a result from a competition is not that, however true
            it is.
          </p>
        </div>
      )}
    </section>
  );
}
