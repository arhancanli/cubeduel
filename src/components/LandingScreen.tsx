"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { SolverDemo } from "@/components/SolverDemo";
import { Reveal } from "@/components/Reveal";
import { ScrollSolve } from "@/components/ScrollSolve";
import { SiteHeader } from "@/components/SiteHeader";
import { formatMs } from "@/lib/format";
import { ratingForMs } from "@/lib/rating";
import { loadHistory } from "@/lib/solveHistory";

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

export function LandingScreen() {
  const [returningSolves, setReturningSolves] = useState<number | null>(null);

  useEffect(() => {
    setReturningSolves(loadHistory().length);
  }, []);

  const returning = (returningSolves ?? 0) > 0;

  return (
    <main className="flex min-h-dvh flex-col">
      <SiteHeader active="play" />

      {/* Hero */}
      <section className="flex flex-col items-center gap-10 px-6 pb-24 pt-12 text-center sm:pt-20">
        <Reveal className="flex max-w-2xl flex-col items-center gap-6">
          <h1 className="text-balance text-4xl font-medium leading-[1.1] tracking-tight sm:text-6xl">
            A rating that actually means something.
          </h1>
          <p className="max-w-xl text-balance text-base leading-relaxed text-muted sm:text-lg">
            Speedcubing with a real ladder. The server hands you a scramble nobody
            has seen, replays your solve to prove it happened, and only then does
            it count. Plus the analysis that tells you which part of your solve to
            fix.
          </p>
        </Reveal>

        <Reveal delayMs={120} className="flex flex-col items-center gap-3">
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/timer"
              className="rounded-lg bg-foreground px-7 py-3.5 text-sm font-medium text-background transition-opacity hover:opacity-90"
            >
              {returning ? "Continue solving" : "Start solving"}
            </Link>
            <Link
              href="/ranked"
              className="rounded-lg border border-border px-7 py-3.5 text-sm text-muted transition-colors hover:border-muted-dim hover:text-foreground"
            >
              Play ranked
            </Link>
          </div>
          <p className="text-xs text-muted-dim">
            {returning
              ? `${returningSolves} solves saved on this device.`
              : "Solving needs no account. Free, and it works offline."}
          </p>
        </Reveal>

        {/* A cube that solves itself, rather than one sitting there scrambled.
            The scramble is WCA random-state, the solution comes from the solver
            in this repository, and the two numbers underneath were measured
            when it was generated. It is the one claim on this page a visitor
            can check. */}
        <Reveal delayMs={220} className="w-full">
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
            <h2 className="text-balance text-3xl font-medium tracking-tight sm:text-4xl">
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
                <h3 className="text-sm font-medium">{card.title}</h3>
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
            <h2 className="text-balance text-3xl font-medium tracking-tight sm:text-4xl">
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
                title: "Phase splits",
                body: "Tap through the stages as you solve, or connect a smart cube and let it read every turn. Either way you get cross, F2L, OLL and PLL separately.",
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
                <h3 className="text-sm font-medium">{card.title}</h3>
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
            <h2 className="text-balance text-3xl font-medium tracking-tight sm:text-4xl">
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
              className="rounded-lg border border-border px-7 py-3.5 text-sm text-muted transition-colors hover:border-muted-dim hover:text-foreground"
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
            <h2 className="text-balance text-3xl font-medium tracking-tight sm:text-4xl">
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
              className="rounded-lg border border-border px-7 py-3.5 text-sm text-muted transition-colors hover:border-muted-dim hover:text-foreground"
            >
              Try today&apos;s
            </Link>
          </Reveal>
        </div>
      </section>

      {/* No cube? */}
      <section className="border-t border-border">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-28">
          <Reveal className="flex flex-col gap-4">
            <h2 className="text-balance text-3xl font-medium tracking-tight sm:text-4xl">
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
            <h2 className="text-balance text-2xl font-medium tracking-tight sm:text-3xl">
              Start with one solve.
            </h2>
            <Link
              href="/timer"
              className="rounded-lg bg-foreground px-7 py-3.5 text-sm font-medium text-background transition-opacity hover:opacity-90"
            >
              {returning ? "Continue solving" : "Start solving"}
            </Link>
            <p className="text-xs text-muted-dim">
              WCA-legal random-state scrambles. Works offline. No account needed to solve.
            </p>
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
