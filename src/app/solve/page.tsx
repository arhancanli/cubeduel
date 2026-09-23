import type { Metadata } from "next";
import Link from "next/link";

import { GuideStep } from "@/components/GuideStep";
import { KeyMapHint } from "@/components/KeyMapHint";
import { Reveal } from "@/components/Reveal";
import { SiteHeader } from "@/components/SiteHeader";
import { SOLVE_STEPS } from "@/lib/beginner";
import { SITE_URL } from "@/lib/site";

export const metadata: Metadata = {
  title: "How to solve a Rubik's cube — beginner's method in 7 steps",
  description:
    "Learn to solve a Rubik's cube in seven steps, one layer at a time. Every algorithm runs on a 3D cube you can turn and step through, and every step says what it leaves alone. Free, for complete beginners.",
  alternates: { canonical: "/solve" },
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
      {/* The guide as structured steps, so a search result can show them. Built
          from the same SOLVE_STEPS the page renders, never typed twice. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "HowTo",
            name: "How to solve a Rubik's cube",
            description: "The beginner's method: seven steps, one layer at a time.",
            totalTime: "PT3H",
            step: SOLVE_STEPS.map((step, i) => ({
              "@type": "HowToStep",
              position: i + 1,
              name: step.title,
              text: step.goal,
              url: `${SITE_URL}/solve#${step.slug}`,
            })),
          }).replace(/</g, "\\u003c"),
        }}
      />

      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-12 px-6 pb-24 pt-8">
        <Reveal className="flex flex-col gap-4">
          <h1 className="text-balance text-4xl leading-[1.05] sm:text-5xl">
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
          <h2 className="text-lg">
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
            <GuideStep key={step.slug} step={step} />
          ))}
        </ol>

        {/* ---------------------------------------------------------------- */}
        <Reveal className="flex flex-col gap-4 border-t border-border pt-10">
          <h2 className="text-lg tracking-tight">Once you can do it</h2>
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
              className="btn-go px-5 py-2.5 text-sm"
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
            <Link
              href="/solve/2x2"
              className="rounded-lg border border-border px-5 py-2.5 text-sm transition-colors hover:border-muted-dim"
            >
              Solve a 2×2
            </Link>
          </div>
        </Reveal>

        {/* ---------------------------------------------------------------- */}
        <Reveal className="flex flex-col gap-4 border-t border-border pt-10">
          <h2 className="text-lg">
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
