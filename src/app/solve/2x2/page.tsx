import type { Metadata } from "next";
import Link from "next/link";

import { GuideStep } from "@/components/GuideStep";
import { Reveal } from "@/components/Reveal";
import { SiteHeader } from "@/components/SiteHeader";
import { SOLVE_2X2_STEPS } from "@/lib/beginner2x2";
import { SITE_URL } from "@/lib/site";

export const metadata: Metadata = {
  title: "How to solve a 2x2 Rubik's cube — beginner's method in 3 steps",
  description:
    "Solve a 2x2 cube in three steps with three algorithms. Every algorithm runs on a 3D 2x2 you can step through, and the instructions are checked against every position the cube can reach. Free, for complete beginners.",
  alternates: { canonical: "/solve/2x2" },
};

/**
 * The 2×2 guide.
 *
 * Same shape as `/solve`, and the same promise: what the page tells you to do
 * has been followed, as written, from every top layer a solve can reach — see
 * `beginner2x2.test.ts`. That test is not decoration; it caught the first draft
 * of step 2 telling people to hold the cube a way that can take four Sunes.
 */
export default function Solve2x2Page() {
  return (
    <main className="flex min-h-dvh flex-col">
      <SiteHeader active="solve" />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "HowTo",
            name: "How to solve a 2x2 Rubik's cube",
            description: "The beginner's method: three steps, three algorithms.",
            totalTime: "PT1H",
            step: SOLVE_2X2_STEPS.map((step, i) => ({
              "@type": "HowToStep",
              position: i + 1,
              name: step.title,
              text: step.goal,
              url: `${SITE_URL}/solve/2x2#${step.slug}`,
            })),
          }).replace(/</g, "\\u003c"),
        }}
      />

      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-12 px-6 pb-24 pt-8">
        <Reveal className="flex flex-col gap-4">
          <h1 className="text-balance text-4xl leading-[1.05] sm:text-5xl">
            How to solve a 2&times;2 cube
          </h1>
          <p className="max-w-xl text-sm leading-relaxed text-muted">
            Three steps and three algorithms. A 2&times;2 is a normal cube with
            only its corners, so this is the first-timer&rsquo;s method with
            everything about edges taken away — most people have it in under an
            hour.
          </p>
          <p className="max-w-xl text-sm leading-relaxed text-muted-dim">
            Each rule on this page has been followed, exactly as written, from
            every position the top of the cube can be in. Step 2 never needs more
            than three goes, and step 3 always needs just one.
          </p>
        </Reveal>

        <Reveal className="panel flex flex-col gap-3 rounded-2xl p-5">
          <h2 className="text-lg">Before you start</h2>
          <p className="text-sm leading-relaxed text-muted">
            Hold the cube with <span className="text-foreground">white on the bottom</span>{" "}
            and yellow on top, and keep it that way.
          </p>
          <p className="text-sm leading-relaxed text-muted-dim">
            There are no centres on a 2&times;2, so nothing tells you which side
            is which colour. The corners decide it: once one white corner is
            down, the colours beside it say where its neighbours go.
          </p>
          <p className="text-xs leading-relaxed text-muted-dim">
            <span className="font-mono text-muted">R</span> means turn the right
            side clockwise, <span className="font-mono text-muted">R&rsquo;</span>{" "}
            anticlockwise and <span className="font-mono text-muted">R2</span>{" "}
            twice. <span className="font-mono text-muted">U</span> is the top and{" "}
            <span className="font-mono text-muted">F</span> the front.{" "}
            <Link href="/notation" className="text-foreground underline underline-offset-4">
              Try every move on a cube
            </Link>
            .
          </p>
        </Reveal>

        <ol className="flex list-none flex-col gap-14 p-0">
          {SOLVE_2X2_STEPS.map((step) => (
            <GuideStep key={step.slug} step={step} puzzle="2x2x2" />
          ))}
        </ol>

        <Reveal className="flex flex-col gap-4 border-t border-border pt-10">
          <h2 className="text-lg tracking-tight">Once you can do it</h2>
          <p className="max-w-xl text-sm leading-relaxed text-muted">
            You already know most of the 3&times;3. Its first layer, its yellow
            corners and its last corner swap are these same three ideas; what it
            adds are the edges.
          </p>
          <div className="flex flex-wrap gap-3 pt-1">
            <Link href="/solve" className="btn-go px-5 py-2.5 text-sm">
              Solve a 3&times;3
            </Link>
            <Link
              href="/notation"
              className="rounded-lg border border-border px-5 py-2.5 text-sm transition-colors hover:border-muted-dim"
            >
              Cube notation
            </Link>
          </div>
        </Reveal>
      </div>
    </main>
  );
}
