import type { Metadata } from "next";
import Link from "next/link";

import { PageHero } from "@/components/PageHero";
import { SiteHeader } from "@/components/SiteHeader";
import { SolverScreen } from "@/components/SolverScreen";
import { SITE_URL } from "@/lib/site";

export const metadata: Metadata = {
  title: "Rubik's Cube Solver — solve any cube in about 19 moves",
  description:
    "Free online Rubik's cube solver. Enter your cube's colours and get a solution in about 19 moves in a fraction of a second, then follow it step by step on a 3D cube. Tells you in plain words if a sticker is wrong.",
  alternates: { canonical: "/solver" },
  openGraph: {
    title: "Rubik's Cube Solver — any cube in about 19 moves",
    description: "Enter your cube's colours, get the solution, follow it on a 3D cube. Free.",
    url: `${SITE_URL}/solver`,
  },
};

const FAQ: { q: string; a: string }[] = [
  {
    q: "How many moves does the solver take?",
    a: "About 19 on average. It uses Kociemba's two-phase algorithm with an exact distance table, and on random cubes it averages 18.9 moves. The shortest possible solution for a random cube is usually 17 or 18 moves, so it is within a move or two of perfect.",
  },
  {
    q: "Which way do I hold the cube?",
    a: "White centre on top, green centre facing you. The net shows the faces as if the cube were unfolded around the green face: white above, yellow below, orange to the left, red to the right and blue at the back.",
  },
  {
    q: "It says my cube is impossible. Why?",
    a: "Some colour layouts can't be reached by turning — a single corner twisted in place, one edge flipped, or two pieces swapped. That usually means a sticker was entered on the wrong square, or the cube was taken apart and put back together wrongly. The message says which kind of piece to check.",
  },
  {
    q: "What do R, U' and F2 mean?",
    a: "Each letter is a face: R right, L left, U up (top), D down (bottom), F front, B back. A letter alone is a clockwise quarter turn as you look at that face, an apostrophe means anticlockwise, and a 2 means turn it twice.",
  },
  {
    q: "Is it free?",
    a: "Yes. Cubeduel is free and open source, with no ads and no account needed.",
  },
];

export default function SolverPage() {
  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "WebApplication",
      name: "Cubeduel Rubik's Cube Solver",
      url: `${SITE_URL}/solver`,
      applicationCategory: "GameApplication",
      operatingSystem: "Any",
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
      description: "Enter a Rubik's cube's colours and get a solution in about 19 moves.",
    },
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: FAQ.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
    },
  ];

  return (
    <main className="flex min-h-dvh flex-col">
      <SiteHeader active="solver" />
      <script
        type="application/ld+json"
        // Built from constants on this page; nothing user-supplied reaches it.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
      />
      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-10 px-4 pb-24 pt-6 sm:px-8 lg:pt-12">
        <PageHero eyebrow="Free tool" title="Rubik's Cube Solver">
          Enter the colours of the cube in your hands and get a solution in about 19 moves — then follow
          it turn by turn on a 3D cube.
        </PageHero>

        <SolverScreen />

        <section aria-labelledby="how-heading" className="grid gap-8 lg:grid-cols-2">
          <div className="flex flex-col gap-3">
            <h2 id="how-heading" className="text-2xl">How it works</h2>
            <p className="text-base leading-relaxed text-muted">
              The solver reads your 54 stickers into the 20 pieces of the cube, checks that a real cube
              could look like that, and then searches for a short way back to solved using Herbert
              Kociemba&rsquo;s two-phase algorithm. The first phase brings the cube into a smaller group
              of positions that only need half turns on four faces; the second solves it from there. An
              exact table of distances — 141 million entries — lets it skip almost everything that
              can&rsquo;t lead anywhere, so an answer usually arrives in a few hundredths of a second.
            </p>
            <p className="text-base leading-relaxed text-muted">
              It finds a short solution, not always the shortest possible one. That&rsquo;s the trade that
              makes it instant; proving a solution is the very shortest can take far longer.
            </p>
          </div>
          <div className="flex flex-col gap-3">
            <h2 className="text-2xl">Want to solve it yourself?</h2>
            <p className="text-base leading-relaxed text-muted">
              A solver gets you out of a jam. Learning to solve it takes an afternoon: seven steps, one
              layer at a time.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link href="/solve" className="btn-go px-5 py-3 text-sm">
                Learn to solve it
              </Link>
              <Link href="/timer" className="btn-secondary px-5 py-3 text-sm">
                Time your solves
              </Link>
            </div>
          </div>
        </section>

        <section aria-labelledby="faq-heading" className="flex flex-col gap-4">
          <h2 id="faq-heading" className="text-2xl">Questions</h2>
          <div className="flex flex-col divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
            {FAQ.map((f) => (
              <details key={f.q} className="group px-5 py-4">
                <summary className="cursor-pointer list-none font-semibold">
                  {f.q}
                </summary>
                <p className="mt-2 text-sm leading-relaxed text-muted">{f.a}</p>
              </details>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
