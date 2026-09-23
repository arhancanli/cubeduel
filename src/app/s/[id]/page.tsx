import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { SiteHeader } from "@/components/SiteHeader";
import { SolveBreakdown } from "@/components/SolveBreakdown";
import { SolveStudy } from "@/components/SolveStudy";
import { EVENTS } from "@/lib/events";
import { formatMs } from "@/lib/format";
import { solvePage } from "@/lib/server/solvePage";
import { isDatabaseConfigured } from "@/lib/server/supabase";
import { reviewSolve } from "@/lib/solveReview";

export const dynamic = "force-dynamic";

/**
 * One solve, addressable forever.
 *
 * Every timer on the internet can tell you that you took 14.2 seconds. This is
 * the page that can show you the 14.2 seconds — the move stream played back at
 * the speed it happened, with the phase that cost you the time named against
 * your own average rather than against a stranger's.
 *
 * It is the most direct expression of the thing this project is actually built
 * on. The rating is the hook; the move stream is the moat, and a moat nobody can
 * link to is not doing any work.
 *
 * ## What this page will not say
 *
 * A solve that failed verification is shown, and shown as unverified. The
 * alternative — hiding it — would mean the only solves with permalinks are the
 * ones that count, and somebody would eventually notice that a missing page is
 * itself an accusation. Better to state the fact plainly.
 *
 * A DNF keeps its time visible with the DNF beside it, for the same reason: the
 * time was real, it just does not count, and those are two different claims.
 */

export async function generateMetadata(props: PageProps<"/s/[id]">): Promise<Metadata> {
  const { id } = await props.params;
  if (!isDatabaseConfigured()) return { title: "cubeduel" };

  const solve = await solvePage(id);
  if (!solve) return { title: "Solve not found" };

  const time = solve.penalty === "DNF" ? "DNF" : formatMs(solve.durationMs);
  const title = `${time} · ${EVENTS[solve.event].name} by @${solve.handle}`;

  return {
    title,
    description:
      `${solve.moveCount} moves at ${solve.tps.toFixed(1)} turns per second. ` +
      `Watch it back move by move.`,
    // A shared solve should look like a solve in the preview card rather than
    // like the site's front page.
    openGraph: { title, type: "article" },
  };
}

export default async function SolvePage(props: PageProps<"/s/[id]">) {
  const { id } = await props.params;

  if (!isDatabaseConfigured()) notFound();

  const solve = await solvePage(id);
  if (!solve) notFound();

  // Par from the solves that existed when this one happened, so the verdict on
  // this page is the same for everybody who opens it and the same next year.
  const review = reviewSolve(solve.splits, solve.durationMs, solve.history);

  const dnf = solve.penalty === "DNF";

  return (
    <main className="flex min-h-dvh flex-col">
      <SiteHeader active="progress" />

      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-10 px-4 pb-24 pt-6 sm:px-8 lg:pt-12">
        {/* ---------------------------------------------------------------- */}
        <header className="flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <h1 className="tnum text-5xl">
              {dnf ? "DNF" : formatMs(solve.durationMs)}
            </h1>
            {dnf ? (
              <span className="tnum font-mono text-sm text-muted-dim">
                {formatMs(solve.durationMs)} on the clock
              </span>
            ) : null}
            {solve.penalty === "PLUS2" ? (
              <span className="font-mono text-sm text-holding">+2</span>
            ) : null}
          </div>

          <p className="text-sm text-muted">
            {EVENTS[solve.event].name} by{" "}
            <Link
              href={`/u/${solve.handle}`}
              className="text-foreground underline underline-offset-4 decoration-border transition-colors hover:decoration-current"
            >
              @{solve.handle}
            </Link>{" "}
            · {solve.moveCount} moves · {solve.tps.toFixed(1)} TPS
          </p>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Tag>{solve.mode}</Tag>
            <Tag>{solve.source === "smartcube" ? "smart cube" : solve.source}</Tag>
            {solve.verified ? (
              <span className="rounded-full border border-ready/40 px-2.5 py-1 text-ready">
                verified
              </span>
            ) : (
              <span className="rounded-full border border-border px-2.5 py-1 text-muted-dim">
                not verified
              </span>
            )}
          </div>
        </header>

        {/* ---------------------------------------------------------------- */}
        {solve.moves.length > 0 ? (
          <SolveStudy
            scramble={solve.scramble}
            moves={solve.moves}
            durationMs={solve.durationMs}
            showBreakdown={false}
          />
        ) : (
          <p className="rounded-lg border border-dashed border-border px-4 py-5 text-sm leading-relaxed text-muted-dim">
            No move stream was recorded for this solve, so there is nothing to
            play back. Solves entered by hand keep their time and nothing else —
            the replay needs the turns, and a time typed in did not come with any.
          </p>
        )}

        {/* ---------------------------------------------------------------- */}
        <section className="flex flex-col gap-3">
          <h2 className="text-[10px] uppercase tracking-widest text-muted-dim">Scramble</h2>
          <p className="break-words rounded-lg border border-border bg-surface px-4 py-3 font-mono text-sm leading-relaxed">
            {solve.scramble}
          </p>
        </section>

        {/* ---------------------------------------------------------------- */}
        {solve.splits.length > 0 ? (
          <section className="flex flex-col gap-3">
            <h2 className="text-[10px] uppercase tracking-widest text-muted-dim">
              Where the time went
            </h2>
            <SolveBreakdown splits={solve.splits} />
          </section>
        ) : null}

        {/* ---------------------------------------------------------------- */}
        {review.kind === "reviewed" ? (
          <section className="flex flex-col gap-3">
            <h2 className="text-[10px] uppercase tracking-widest text-muted-dim">
              Against their own average
            </h2>

            <p className="max-w-lg text-sm leading-relaxed text-muted">
              {review.culprit ? (
                <>
                  <span className="text-foreground">{review.culprit.phase}</span> took{" "}
                  <span className="tnum font-mono text-foreground">
                    {formatMs(Math.round(review.culprit.gapMs))}
                  </span>{" "}
                  longer than usual — {Math.round(review.culpritShare * 100)}% of all the
                  time lost in this solve.
                </>
              ) : (
                <>Nothing in this solve was slower than usual.</>
              )}
            </p>

            <p className="text-xs leading-relaxed text-muted-dim">
              &ldquo;Usual&rdquo; is the {review.sampleSize} solves they had done before this
              one, so this reads the same today as it will next year. A par drawn from
              their whole history would quietly rewrite this verdict every time they
              got faster.
            </p>
          </section>
        ) : null}

        {/* ---------------------------------------------------------------- */}
        {solve.ollCase || solve.pllCase ? (
          <section className="flex flex-wrap gap-6">
            {solve.ollCase ? <Case label="OLL" value={solve.ollCase} /> : null}
            {solve.pllCase ? <Case label="PLL" value={solve.pllCase} /> : null}
          </section>
        ) : null}
      </div>
    </main>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border border-border px-2.5 py-1 text-muted-dim">
      {children}
    </span>
  );
}

function Case({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-widest text-muted-dim">{label}</span>
      <span className="font-mono text-sm">{value}</span>
    </div>
  );
}
