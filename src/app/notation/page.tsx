import type { Metadata } from "next";
import Link from "next/link";

import { NotationPlayground } from "@/components/NotationPlayground";
import { PageHero } from "@/components/PageHero";
import { SiteHeader } from "@/components/SiteHeader";

export const metadata: Metadata = {
  title: "Rubik's cube notation — what R, U', F2, M and x mean",
  description:
    "Every Rubik's cube move explained on a 3D cube you can watch: faces, prime and double turns, wide moves, slices and rotations. Tap a move to see it.",
  alternates: { canonical: "/notation" },
};

export default function NotationPage() {
  return (
    <main className="flex min-h-dvh flex-col">
      <SiteHeader active="learn" />
      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-10 px-4 pb-24 pt-6 sm:px-8 lg:pt-12">
        <PageHero eyebrow="Learn" title="Cube notation">
          <p>
            Every algorithm is written in the same short code: a letter for each face, an apostrophe to turn it
            the other way, a 2 to turn it twice. Tap any move to watch what it does.
          </p>
          <p className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm">
            <Link href="/solve" className="font-semibold text-foreground underline decoration-border underline-offset-4 hover:decoration-current">
              Learn to solve
            </Link>
            <Link href="/learn/f2l" className="font-semibold text-foreground underline decoration-border underline-offset-4 hover:decoration-current">
              F2L cases
            </Link>
            <Link href="/learn" className="font-semibold text-foreground underline decoration-border underline-offset-4 hover:decoration-current">
              OLL and PLL
            </Link>
          </p>
        </PageHero>
        <NotationPlayground />
      </div>
    </main>
  );
}
