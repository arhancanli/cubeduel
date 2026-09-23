import type { Metadata } from "next";
import Link from "next/link";

import { LastLayerDiagram } from "@/components/LastLayerDiagram";
import { PageHero } from "@/components/PageHero";
import { SiteHeader } from "@/components/SiteHeader";
import { Reveal } from "@/components/Reveal";
import { learnCases, SHAPE_ORDER, type LearnCase } from "@/lib/learn";

export const metadata: Metadata = {
  title: "Learn the last layer",
  description:
    "All 57 OLL and 21 PLL cases, grouped the way you recognise them, every algorithm checked against the puzzle itself.",
};

/**
 * The case library.
 *
 * Every OLL and PLL there is, arranged the way a cuber meets them rather than the
 * way a database stores them: by the shape on top, because that is what you see
 * in the half second before you decide what to do.
 *
 * The diagrams are drawn by the puzzle engine from each case's own algorithm, so
 * a picture here cannot drift from the moves printed under it. That matters more
 * than it sounds: a case diagram that is subtly wrong is the worst thing this
 * project could ship, because a learner builds recognition on it and only finds
 * out at a competition.
 */
export default async function LearnPage() {
  const cases = await learnCases();
  const oll = cases.filter((c) => c.stage === "OLL");
  const pll = cases.filter((c) => c.stage === "PLL");

  return (
    <main className="flex min-h-dvh flex-col">
      <SiteHeader active="learn" />

      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-14 px-4 pb-24 pt-6 sm:px-8 lg:pt-12">
        <Reveal>
          <PageHero eyebrow="Learn" title="The last layer">
            <p>
              All 57 OLL and 21 PLL cases. Every algorithm here is checked against
              the puzzle itself — the case is built by running the algorithm
              backwards from solved, so the picture, the moves and the name cannot
              drift apart.
            </p>
            <p className="mt-2 text-sm text-muted-dim">
              Grouped by the shape on top, because that is what you actually see in
              the half second before you decide what to do.
            </p>
          </PageHero>
        </Reveal>

        {SHAPE_ORDER.map((shape) => {
          const group = oll.filter((c) => c.shape === shape);
          if (group.length === 0) return null;
          return (
            <Group
              key={shape}
              title={shape}
              note={SHAPE_NOTES[shape]}
              count={group.length}
              cases={group}
            />
          );
        })}

        <Group
          title="PLL"
          note="The pieces are the right way up. Now they have to go home."
          count={pll.length}
          cases={pll}
        />
      </div>
    </main>
  );
}

const SHAPE_NOTES: Record<string, string> = {
  Cross: "The cross is already made. Only the corners are wrong.",
  Line: "Two edges oriented, facing each other.",
  "L-shape": "Two edges oriented, side by side.",
  Dot: "No edge is oriented. The hardest to read, and the most valuable to know cold.",
};

function Group({
  title,
  note,
  count,
  cases,
}: {
  title: string;
  note: string;
  count: number;
  cases: LearnCase[];
}) {
  return (
    <Reveal className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline gap-3">
          <h2 className="text-lg tracking-tight">{title}</h2>
          <span className="font-mono text-xs tabular-nums text-muted-dim">{count}</span>
        </div>
        <p className="max-w-lg text-xs leading-relaxed text-muted-dim">{note}</p>
      </div>

      <ul className="grid list-none grid-cols-2 gap-3 p-0 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
        {cases.map((c) => (
          <li key={c.slug}>
            <Link
              href={`/learn/${c.slug}`}
              className="panel lift group flex flex-col gap-2 rounded-xl p-3 hover:border-muted-dim"
            >
              <LastLayerDiagram setup={c.setup} label={c.label} />
              <div className="flex flex-col gap-0.5">
                <span className="text-xs font-medium">{c.label}</span>
                <span className="truncate text-[11px] text-muted-dim">
                  {c.name && c.name !== c.label.split(" ")[1] ? c.name : `${c.moveCount} moves`}
                </span>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </Reveal>
  );
}
