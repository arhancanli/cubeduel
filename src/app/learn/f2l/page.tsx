import type { Metadata } from "next";
import Link from "next/link";

import { F2LCases, type F2LCaseView } from "@/components/F2LCases";
import { PageHero } from "@/components/PageHero";
import { SiteHeader } from "@/components/SiteHeader";
import cases from "@/data/f2l.json";
import { GROUP_ORDER } from "@/lib/f2l";

export const metadata: Metadata = {
  title: "All 41 F2L cases and algorithms",
  description:
    "Every first-two-layers (F2L) case with an algorithm you can step through on a 3D cube, grouped by where the corner and edge start. Each algorithm is checked against the puzzle.",
  alternates: { canonical: "/learn/f2l" },
};

const NOTES: Record<string, string> = {
  "Both on top":
    "The corner and the edge are both in the top layer. The most common situation, and the one worth knowing best.",
  "Corner on top, edge in slot": "The edge is already in the slot, the corner is up top. Take the edge out and pair them.",
  "Edge on top, corner in slot": "The corner is in the slot, the edge is up top. Lift the corner, pair it, put it back.",
  "Both in slot": "Both pieces are in the slot but not solved — flipped, twisted, or both. Take them out and try again.",
};

export default function F2LPage() {
  const groups = GROUP_ORDER.map((title) => ({
    title,
    note: NOTES[title],
    cases: (cases as (F2LCaseView & { key: string })[])
      .filter((c) => c.group === title)
      .map(({ number, group, alg, moves }) => ({ number, group, alg, moves })),
  }));

  return (
    <main className="flex min-h-dvh flex-col">
      <SiteHeader active="learn" />
      <div className="page-frame flex w-full max-w-5xl flex-1 flex-col gap-12 px-4 pb-24 pt-6 sm:px-8 lg:pt-12">
        <PageHero eyebrow="Algorithms · first two layers" title="All 41 F2L cases">
          <p>
            F2L pairs one corner with one edge and puts them in a slot together. Every case below is for the
            front-right slot, with your cross on the bottom: find where the two pieces are, then use the
            algorithm. Every algorithm here was found by search over the moves cubers actually use — R U R&apos;
            and F&apos; U&apos; F with turns of the top — and checked to insert its pair without disturbing
            anything else.
          </p>
          <p className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm">
            <Link href="/notation" className="font-semibold text-foreground underline decoration-border underline-offset-4 hover:decoration-current">
              What the letters mean
            </Link>
            <Link href="/learn" className="font-semibold text-foreground underline decoration-border underline-offset-4 hover:decoration-current">
              OLL and PLL
            </Link>
          </p>
        </PageHero>
        <F2LCases groups={groups} />
      </div>
    </main>
  );
}
