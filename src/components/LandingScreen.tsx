"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { SolverDemo } from "@/components/SolverDemo";
import { Reveal } from "@/components/Reveal";
import { ScrollSolve } from "@/components/ScrollSolve";
import { SiteHeader } from "@/components/SiteHeader";
import { ratingForMs } from "@/lib/rating";
import { CubeNet } from "@/components/CubeNet";
import { TodayStrip } from "@/components/TodayStrip";
import { formatAverage, formatMs } from "@/lib/format";
import { ao5, bestSingle } from "@/lib/stats";
import { loadHistory, type StoredSolve } from "@/lib/solveHistory";

/**
 * The front door.
 *
 * Two rules govern it, and they survived the platform being added on top.
 *
 * **Nothing here asks anyone to sign up before solving.** Chess.com's landing
 * page works because "Play" starts a game, not a registration form. Ranked needs
 * an account because a rating has to belong to someone, but it is the *second*
 * button, never the first — the account earns itself once there is something
 * worth keeping.
 *
 * **Anyone who has already solved here should not be sold to again.** If there is
 * local history the page leads with "Continue" and the pitch moves out of the way.
 */

export function LandingScreen({ dailyStart }: { dailyStart: string }) {
  const [history, setHistory] = useState<StoredSolve[] | null>(null);

  useEffect(() => {
    setHistory(loadHistory());
  }, []);

  const returning = (history?.length ?? 0) > 0;

  return (
    <main className="flex min-h-dvh flex-col">
      <SiteHeader active="home" />

      {/* Hero: the claim on the left, the six modes on the right as a cube net. */}
      <section className="mx-auto grid w-full max-w-6xl items-center gap-10 px-4 pb-14 pt-6 sm:px-8 sm:pt-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,34rem)] lg:gap-14 lg:pt-20">
        <Reveal className="flex flex-col gap-6">
          <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-sticker-green">
            {returning ? "Welcome back" : "Speedcubing, on the record"}
          </p>
          <h1 className="text-balance text-[2.6rem] leading-[1.02] sm:text-6xl xl:text-7xl">
            Every solve here is proven.
          </h1>
          <p className="max-w-xl text-pretty text-base leading-relaxed text-muted sm:text-lg">
            The server hands you a scramble nobody has seen, replays every turn,
            and only then does the time count. Then it shows you which part of
            your solve is slow.
          </p>

          <div className="flex flex-wrap items-center gap-3">
            <Link href="/timer" className="btn-go px-7 py-3.5 text-base">
              {returning ? "Continue solving" : "Start solving"}
            </Link>
            <Link href="/ranked" className="btn-secondary px-6 py-3.5 text-base">
              Play ranked
            </Link>
          </div>

          {returning && history ? (
            <ReturningStats history={history} />
          ) : (
            <p className="text-sm text-muted-dim">Solving needs no account. Free, and it works offline.</p>
          )}

          {/* The other half of the audience: every call to action above assumes
              you can already solve a cube. One quiet line rather than a third
              button, because two competing buttons already argue. */}
          <Link
            href="/solve"
            className="self-start text-sm text-muted underline decoration-border underline-offset-4 transition-colors hover:text-foreground hover:decoration-current"
          >
            Can&rsquo;t solve one yet? Start here.
          </Link>
        </Reveal>

        <Reveal delayMs={140}>
          <CubeNet />
        </Reveal>
      </section>

      <section className="mx-auto w-full max-w-6xl px-4 pb-20 sm:px-8">
        <TodayStrip dailyStart={dailyStart} />
      </section>

      {/* A cube that solves itself. The scramble is WCA random-state, the
          solution comes from the solver in this repository, and the two numbers
          underneath were measured when it was generated. It is the one claim on
          this page a visitor can check. */}
      <section className="border-t border-border">
        <div className="mx-auto flex w-full max-w-3xl flex-col items-center gap-6 px-6 pt-24 text-center">
          <Reveal className="flex flex-col items-center gap-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-dim">The engine</p>
            <h2 className="text-balance text-3xl sm:text-4xl">It solves any cube in about 19 moves.</h2>
          </Reveal>
        </div>
        <Reveal delayMs={120} className="w-full px-6 pb-8">
          <SolverDemo />
        </Reveal>
      </section>

      {/* The product, running, driven by scroll. */}
      <ScrollSolve />

      {/* The ladder */}
      <section className="border-t border-border">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-12 px-6 py-28">
          <Reveal className="flex flex-col gap-4">
            <p className="text-[10px] uppercase tracking-widest text-muted-dim">
              Ranked
            </p>
            <h2 className="text-balance text-3xl tracking-tight sm:text-4xl">
              One number, and you can always read it in seconds.
            </h2>
            <p className="max-w-xl text-base leading-relaxed text-muted">
              Chess needs Elo because it has no absolute scale — you only ever
              learn that one player beat another. Cubing has seconds. So the
              rating is fixed to two landmarks the sport already uses, and every
              rating converts straight back into the average that earned it.
            </p>
          </Reveal>

          <Reveal delayMs={100}>
            <RatingScale />
          </Reveal>

          <div className="grid gap-10 sm:grid-cols-3">
            {[
              {
                title: "The server picks the puzzle",
                body: "Every ranked scramble is generated when you ask for it, so there is nothing to cherry-pick and nothing to solve in advance.",
              },
              {
                title: "Every solve is replayed",
                body: "Your moves are applied to that exact scramble on the server. If the cube does not end solved, the result does not exist.",
              },
              {
                title: "Failure costs certainty",
                body: "Abandon a bad solve and your rating cannot rise — a failed average widens your margin instead of inventing a time for you.",
              },
            ].map((card, i) => (
              <Reveal key={card.title} delayMs={i * 90} className="flex flex-col gap-2">
                <h3 className="text-sm">{card.title}</h3>
                <p className="text-sm leading-relaxed text-muted">{card.body}</p>
              </Reveal>
            ))}
          </div>

          <Reveal delayMs={120}>
            <Link
              href="/leaderboard"
              className="text-sm text-foreground underline-offset-4 hover:underline"
            >
              See the leaderboard →
            </Link>
          </Reveal>
        </div>
      </section>

      {/* What the splits are for */}
      <section className="border-t border-border">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-16 px-6 py-28">
          <Reveal className="flex flex-col gap-4">
            <h2 className="text-balance text-3xl tracking-tight sm:text-4xl">
              A stopwatch tells you that you took 22 seconds.
            </h2>
            <p className="text-base leading-relaxed text-muted">
              It does not tell you that F2L pair three costs you 2.1 seconds every single
              solve, or that your OLL time swings between one and four seconds depending on
              which case you get. Those are different problems with different fixes, and the
              total hides both.
            </p>
          </Reveal>

          <div className="grid gap-10 sm:grid-cols-3">
            {[
              {
                title: "Looking, or turning",
                body: "Every stage is split in two: the time before your first turn, and the time spent turning. Slow to see and slow to do are different problems — and your slow solves say which one is yours.",
              },
              {
                title: "The case, not the stage",
                body: "It works out which OLL and PLL you actually faced, then ranks them by how much time you would get back — how often it comes up, times how slow it is.",
              },
              {
                title: "Honest about itself",
                body: "Nothing is claimed below a stated sample size, and a change inside normal variation is reported as no change instead of as progress.",
              },
            ].map((card, i) => (
              <Reveal key={card.title} delayMs={i * 90} className="flex flex-col gap-2">
                <h3 className="text-sm">{card.title}</h3>
                <p className="text-sm leading-relaxed text-muted">{card.body}</p>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* Rush — the mode nothing else in cubing has. */}
      <section className="border-t border-border">
        <div className="mx-auto flex w-full max-w-3xl flex-col items-center gap-8 px-6 py-28 text-center">
          <Reveal className="flex flex-col items-center gap-4">
            <p className="text-[10px] uppercase tracking-widest text-muted-dim">
              Under pressure
            </p>
            <h2 className="text-balance text-3xl tracking-tight sm:text-4xl">
              A target that keeps tightening.
            </h2>
            <p className="max-w-xl text-balance text-base leading-relaxed text-muted">
              Every timer tells you your average afterwards. None of them ever put
              you in the position of needing <em>this</em> solve to be fast — which
              is what a competition round actually is. In Rush the number is on
              screen before you turn a face, and it shrinks every time you beat it.
              Three misses ends the run.
            </p>
            <p className="max-w-xl text-balance text-sm leading-relaxed text-muted-dim">
              The target comes from your own pace, so it is the same difficulty
              whether you average eight seconds or forty. A fixed number would be a
              lazy solve for one and unreachable for the other; this finds the edge
              of what you can do today, which is the only place anybody improves.
            </p>
          </Reveal>
          <Reveal delayMs={120}>
            <Link
              href="/rush"
              className="btn-secondary px-7 py-3.5 text-sm"
            >
              Start a run
            </Link>
          </Reveal>
        </div>
      </section>

      {/* The daily */}
      <section className="border-t border-border">
        <div className="mx-auto flex w-full max-w-3xl flex-col items-center gap-8 px-6 py-28 text-center">
          <Reveal className="flex flex-col items-center gap-4">
            <p className="text-[10px] uppercase tracking-widest text-muted-dim">Every day</p>
            <h2 className="text-balance text-3xl tracking-tight sm:text-4xl">
              One scramble. One attempt.
            </h2>
            <p className="max-w-xl text-balance text-base leading-relaxed text-muted">
              The same cube for everyone, resetting at midnight UTC. Your time is final the
              moment the clock starts — so the result you share is the one you actually got.
            </p>
          </Reveal>
          <Reveal delayMs={120}>
            <Link
              href="/daily"
              className="btn-secondary px-7 py-3.5 text-sm"
            >
              Try today&apos;s
            </Link>
          </Reveal>
        </div>
      </section>

      {/* Learning to solve at all */}
      <section className="border-t border-border">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-28">
          <Reveal className="flex flex-col gap-4">
            <p className="text-[10px] uppercase tracking-widest text-muted-dim">
              From the beginning
            </p>
            <h2 className="text-balance text-3xl tracking-tight sm:text-4xl">
              You do not have to be able to solve one yet.
            </h2>
            <p className="max-w-xl text-base leading-relaxed text-muted">
              Seven steps, one layer at a time, with every algorithm running on a
              cube you can turn and step through move by move. Most people get
              there in an afternoon.
            </p>
            <p className="max-w-xl text-base leading-relaxed text-muted-dim">
              Each step also says what it will <em>not</em> disturb — and those
              promises are checked against the puzzle rather than written down,
              because &ldquo;this will not wreck your first two layers&rdquo; is the
              sentence a beginner has to be able to trust, and the one most guides
              get wrong.
            </p>
            <div className="flex flex-wrap gap-5 pt-1">
              <Link
                href="/solve"
                className="text-sm text-foreground underline-offset-4 hover:underline"
              >
                How to solve a cube →
              </Link>
              <Link
                href="/learn"
                className="text-sm text-muted underline-offset-4 hover:text-foreground hover:underline"
              >
                All 57 OLL and 21 PLL cases →
              </Link>
            </div>
          </Reveal>
        </div>
      </section>

      {/* No cube? */}
      <section className="border-t border-border">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-28">
          <Reveal className="flex flex-col gap-4">
            <h2 className="text-balance text-3xl tracking-tight sm:text-4xl">
              No cube in your hand?
            </h2>
            <p className="max-w-xl text-base leading-relaxed text-muted">
              Solve one with your keyboard. The clock starts on your first turn and stops
              the instant the cube is actually solved — no spacebar, no reaction delay at
              either end. It is the most accurate timing in the app, and it is what ranked
              runs on.
            </p>
            <Link
              href="/play"
              className="text-sm text-foreground underline-offset-4 hover:underline"
            >
              Try keyboard cubing →
            </Link>
          </Reveal>
        </div>
      </section>

      <footer className="border-t border-border">
        <div className="mx-auto flex w-full max-w-3xl flex-col items-center gap-6 px-6 py-24 text-center">
          <Reveal className="flex flex-col items-center gap-5">
            <h2 className="text-balance text-2xl tracking-tight sm:text-3xl">
              Start with one solve.
            </h2>
            <Link
              href="/timer"
              className="btn-go px-7 py-3.5 text-sm"
            >
              {returning ? "Continue solving" : "Start solving"}
            </Link>
            <p className="text-xs text-muted-dim">
              WCA-legal random-state scrambles. Works offline. No account needed to solve.
            </p>
            {/* The one reason not to switch is the history left behind. */}
            <Link
              href="/progress"
              className="text-sm text-foreground underline-offset-4 hover:underline"
            >
              Already on csTimer? Bring your history →
            </Link>
          </Reveal>

          {/* The only place privacy is linked from. A disclosure nobody can
              reach is not a disclosure, and the footer is where people look. */}
          <nav className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs text-muted-dim">
            <Link
              href="/privacy"
              className="underline underline-offset-4 transition-colors hover:text-foreground"
            >
              Privacy
            </Link>
            <a
              href="https://github.com/arhancanli/cubeduel"
              className="underline underline-offset-4 transition-colors hover:text-foreground"
            >
              Source
            </a>
            <Link
              href="/leaderboard"
              className="underline underline-offset-4 transition-colors hover:text-foreground"
            >
              Leaderboard
            </Link>
          </nav>
        </div>
      </footer>
    </main>
  );
}

/**
 * The rating scale, drawn from the real function rather than typed out.
 *
 * This is the clearest possible statement of the design claim above it: the
 * numbers here are computed by `ratingForMs`, so the marketing page cannot drift
 * away from the ladder. If someone moves an anchor, this section moves with it.
 */
function RatingScale() {
  const rows = [5, 10, 15, 20, 30, 60].map((seconds) => ({
    seconds,
    rating: Math.round(ratingForMs(seconds * 1000)),
    label: formatMs(seconds * 1000, { truncate: false }),
  }));

  const max = rows[0].rating;

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      {rows.map((row) => (
        <div
          key={row.seconds}
          className="flex items-center gap-4 border-b border-border bg-surface px-4 py-2.5 last:border-b-0"
        >
          <span className="tnum w-16 shrink-0 text-sm font-medium">{row.rating}</span>
          <span className="relative h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-hi">
            <span
              className="absolute inset-y-0 left-0 rounded-full bg-bar"
              style={{ width: `${(row.rating / max) * 100}%` }}
            />
          </span>
          <span className="tnum w-20 shrink-0 text-right text-xs text-muted-dim">
            {row.label} average
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * What somebody who has solved here already wants to see first: where they are.
 * Read from this device's history, so it works signed out and offline.
 */
function ReturningStats({ history }: { history: StoredSolve[] }) {
  const timed = history.map((solve) => ({ ms: solve.durationMs, penalty: solve.penalty }));
  const best = bestSingle(timed);
  const stats = [
    { label: "Solves", value: history.length.toLocaleString("en") },
    { label: "Best single", value: best === null ? "—" : formatMs(best, { truncate: false }) },
    { label: "Last ao5", value: formatAverage(ao5(timed)) },
  ];
  return (
    <dl className="grid max-w-md grid-cols-3 gap-2">
      {stats.map((stat) => (
        <div key={stat.label} className="rounded-xl border border-border bg-surface px-3.5 py-3">
          <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-dim">{stat.label}</dt>
          <dd className="tnum mt-1 font-display text-xl font-bold">{stat.value}</dd>
        </div>
      ))}
    </dl>
  );
}
