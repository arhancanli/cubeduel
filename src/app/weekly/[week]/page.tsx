import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHero } from "@/components/PageHero";
import { SiteHeader } from "@/components/SiteHeader";
import { WeeklyBoardTable } from "@/components/WeeklyBoardTable";
import { isDatabaseConfigured } from "@/lib/server/supabase";
import { closedScrambles, pastWeeks, weeklyBoard } from "@/lib/server/weekly";
import { isWeekKey, weekEnd, weekKey, weekLabel } from "@/lib/weekly";

export const dynamic = "force-dynamic";

export async function generateMetadata(props: PageProps<"/weekly/[week]">): Promise<Metadata> {
  const { week } = await props.params;
  return isWeekKey(week) ? { title: `Weekly ${week} results` } : { title: "Weekly" };
}

/**
 * A closed week: the board as it finished, and the five scrambles, published
 * now that nobody can still be solving them. The current week has no page of
 * its own here — it is /weekly, and its scrambles are not shown until Monday.
 */
export default async function PastWeekPage(props: PageProps<"/weekly/[week]">) {
  const { week } = await props.params;
  if (!isDatabaseConfigured() || !isWeekKey(week) || weekEnd(week) > Date.now()) notFound();

  const [board, scrambles, earlier] = await Promise.all([weeklyBoard(week), closedScrambles(week), pastWeeks(week, 1)]);
  if (scrambles === null) notFound();

  return (
    <main className="flex min-h-dvh flex-col">
      <SiteHeader active="weekly" />
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-10 px-4 pb-20 pt-6 sm:px-6 lg:pt-14">
        <PageHero eyebrow={`Weekly · ${week}`} title={weekLabel(week)}>
          {board.placed.length === 0
            ? "Nobody finished all five that week."
            : `${board.placed.length} finished all five. Every solve was replayed by the server against its scramble.`}
        </PageHero>

        {board.placed.length > 0 ? <WeeklyBoardTable placed={board.placed} /> : null}

        <section>
          <h2 className="mb-3 text-lg">The five scrambles</h2>
          <ol data-testid="weekly-scrambles" className="flex flex-col gap-2">
            {scrambles.map((scramble, i) => (
              <li key={i} className="flex gap-3 rounded-xl border border-border bg-surface px-4 py-3">
                <span className="tnum text-sm text-muted-dim">{i + 1}</span>
                <span className="font-mono text-sm">{scramble}</span>
              </li>
            ))}
          </ol>
        </section>

        <nav className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted">
          {earlier[0] ? <Link href={`/weekly/${earlier[0]}`} className="hover:text-foreground">← {earlier[0]}</Link> : null}
          <Link href="/weekly" className="hover:text-foreground">This week ({weekKey(Date.now())}) →</Link>
        </nav>
      </div>
    </main>
  );
}
