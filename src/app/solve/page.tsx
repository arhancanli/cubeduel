import type { Metadata } from "next";
import Link from "next/link";

import { AlgDemo } from "@/components/AlgDemo";
import { KeyMapHint } from "@/components/KeyMapHint";
import { Reveal } from "@/components/Reveal";
import { SiteHeader } from "@/components/SiteHeader";
import { REGION_LABEL, SOLVE_STEPS, type SolveStep } from "@/lib/beginner";

export const metadata: Metadata = {
  title: "How to solve a Rubik's cube",
  description:
    "Seven steps, from a scrambled cube to a solved one. Every algorithm runs on a cube you can turn, and every promise about what it leaves alone is checked against the puzzle.",
};

/**
 * The page this site owed anybody who cannot solve a cube yet.
 *
 * `/learn` assumes you already get to the last layer. This assumes nothing.
 *
 * The organising idea is the promise. What actually defeats beginners is not
 * forgetting an algorithm — it is doing one and destroying the part they had
 * already finished, over and over, until they conclude they are not the sort of
 * person who can do this. So every step states plainly what its algorithms leave
 * alone, and every one of those statements is derived from the puzzle in
 * `beginner.test.ts` rather than written down by whoever typed the page.
 */
export default function SolvePage() {
  return (
    <main className="flex min-h-dvh flex-col">
      <SiteHeader active="solve" />

      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-12 px-6 pb-24 pt-8">
        <Reveal className="flex flex-col gap-4">
          <h1 className="text-3xl font-medium leading-tight tracking-tight">
            How to solve a Rubik&rsquo;s cube
          </h1>
          <p className="max-w-xl text-sm leading-relaxed text-muted">
            Seven steps, one layer at a time. It is the method almost everybody
            starts with, and you can be solving a cube unaided by the end of an
            afternoon.
          </p>
          <p className="max-w-xl text-sm leading-relaxed text-muted-dim">
            Every algorithm below runs on a cube you can turn, step it move by
            move, and try yourself on the keyboard. And each step says what it
            leaves alone — because the thing that actually defeats people is not
            forgetting an algorithm, it is doing one and wrecking the part they
            had already finished.
          </p>
        </Reveal>

        {/* ---------------------------------------------------------------- */}
        <Reveal className="panel flex flex-col gap-3 rounded-2xl p-5">
          <h2 className="text-[10px] uppercase tracking-widest text-muted-dim">
            Before you start
          </h2>
          <p className="text-sm leading-relaxed text-muted">
            Hold the cube with <span className="text-foreground">white on the bottom</span>{" "}
            and keep it there. Every instruction on this page assumes you did.
          </p>
          <p className="text-sm leading-relaxed text-muted-dim">
            The centres never move. Whatever colour is in the middle of a side is
            what that side will be when the cube is solved — which is why the
            centres, not the corners, tell you where everything belongs.
          </p>
          <p className="text-xs leading-relaxed text-muted-dim">
            <span className="font-mono text-muted">R</span> means turn the right
            side clockwise. <span className="font-mono text-muted">R&rsquo;</span> (said
            &ldquo;R prime&rdquo;) means anticlockwise, and{" "}
            <span className="font-mono text-muted">R2</span> means twice. Same for{" "}
            <span className="font-mono text-muted">U</span> (up),{" "}
            <span className="font-mono text-muted">F</span> (front),{" "}
            <span className="font-mono text-muted">L</span>,{" "}
            <span className="font-mono text-muted">D</span> and{" "}
            <span className="font-mono text-muted">B</span> — always as if you were
            looking straight at that side.
          </p>
        </Reveal>

        {/* ---------------------------------------------------------------- */}
        <ol className="flex list-none flex-col gap-14 p-0">
          {SOLVE_STEPS.map((step) => (
            <Step key={step.slug} step={step} />
          ))}
        </ol>

        {/* ---------------------------------------------------------------- */}
        <Reveal className="flex flex-col gap-4 border-t border-border pt-10">
          <h2 className="text-lg font-medium tracking-tight">Once you can do it</h2>
          <p className="max-w-xl text-sm leading-relaxed text-muted">
            You are solving a cube. The next thing is not more algorithms — it is
            doing these ones without stopping to think, which is what turns three
            minutes into ninety seconds.
          </p>
          <p className="max-w-xl text-sm leading-relaxed text-muted-dim">
            After that, the method above is replaced one piece at a time. The two
            middle-layer algorithms become F2L, done by looking rather than by
            recognising a case. The last two steps become{" "}
            <Link href="/learn" className="text-foreground underline underline-offset-4">
              the 57 OLL and 21 PLL cases
            </Link>
            , which finish the cube in two algorithms instead of four sets of
            repetitions.
          </p>
          <div className="flex flex-wrap gap-3 pt-1">
            <Link
              href="/play"
              className="rounded-lg bg-foreground px-5 py-2.5 text-sm font-medium text-background transition-opacity hover:opacity-90"
            >
              Try it on a cube
            </Link>
            <Link
              href="/learn"
              className="rounded-lg border border-border px-5 py-2.5 text-sm transition-colors hover:border-muted-dim"
            >
              The last layer
            </Link>
            <Link
              href="/cube"
              className="rounded-lg border border-border px-5 py-2.5 text-sm transition-colors hover:border-muted-dim"
            >
              Use your own cube
            </Link>
          </div>
        </Reveal>

        {/* ---------------------------------------------------------------- */}
        <Reveal className="flex flex-col gap-4 border-t border-border pt-10">
          <h2 className="text-[10px] uppercase tracking-widest text-muted-dim">
            Turning a cube with the keyboard
          </h2>
          <p className="max-w-xl text-xs leading-relaxed text-muted-dim">
            If you have not got a cube in front of you, every algorithm here can be
            done on the virtual one. These are the keys, and they are the same ones
            Twizzle and cstimer use — so what you learn here works elsewhere.
          </p>
          <KeyMapHint activeCode={null} />
        </Reveal>
      </div>
    </main>
  );
}

function Step({ step }: { step: SolveStep }) {
  // The Reveal goes INSIDE the li, not around it. An <ol> may only contain <li>
  // directly, and a wrapper div between them is invalid markup that also strips
  // the list of its meaning for anybody using a screen reader.
  return (
    <li id={step.slug} className="scroll-mt-8">
      <Reveal className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <div className="flex items-baseline gap-3">
            <span className="font-mono text-sm text-muted-dim">{step.number}</span>
            <h2 className="text-xl font-medium tracking-tight">{step.title}</h2>
          </div>
          <p className="max-w-xl text-sm leading-relaxed text-muted">{step.goal}</p>
        </div>

        <div className="flex max-w-xl flex-col gap-2.5">
          {step.idea.map((line, i) => (
            <p key={i} className="text-sm leading-relaxed text-muted-dim">
              {line}
            </p>
          ))}
        </div>

        {step.algorithms.length > 0 ? (
          <div
            className={`grid gap-6 ${
              step.algorithms.length > 1 ? "sm:grid-cols-2" : "sm:max-w-md"
            }`}
          >
            {step.algorithms.map((a) => (
              <div key={a.name} className="panel flex flex-col gap-3 rounded-xl p-4">
                <h3 className="text-sm font-medium">{a.name}</h3>
                {/* The algorithm is not printed twice. The move chips inside the
                    demo are the algorithm, and they also say where you are in
                    it — a second static copy above them was duplication. */}
                <AlgDemo alg={a.alg} label={a.name} hold="z2" />
                <p className="text-xs leading-relaxed text-muted-dim">{a.when}</p>
              </div>
            ))}
          </div>
        ) : null}

        {/* The promise. Derived from the puzzle, not asserted by the author —
            see beginner.test.ts, which fails the build if they disagree. */}
        {step.preserves ? (
          <p className="flex max-w-xl items-start gap-2 text-xs leading-relaxed text-ready">
            <span aria-hidden="true">✓</span>
            <span>
              This will not touch {REGION_LABEL[step.preserves]}. Checked against
              the puzzle, not promised.
            </span>
          </p>
        ) : null}

        {step.note ? (
          <p className="max-w-xl border-l border-border pl-4 text-xs leading-relaxed text-muted-dim">
            {step.note}
          </p>
        ) : null}
      </Reveal>
    </li>
  );
}
