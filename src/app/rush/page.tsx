import type { Metadata } from "next";
import Link from "next/link";

import { RushScreen } from "@/components/RushScreen";
import { SiteHeader } from "@/components/SiteHeader";
import { EVENT_IDS, type EventId } from "@/lib/events";
import { ensureProfile } from "@/lib/server/profiles";
import { bestRun } from "@/lib/server/rush";
import { isDatabaseConfigured } from "@/lib/server/supabase";

export const metadata: Metadata = {
  title: "Rush",
  description:
    "Solve under a target that tightens every time you beat it. Three misses and the run is over.",
};

export const dynamic = "force-dynamic";

export default async function RushPage() {
  if (!isDatabaseConfigured()) {
    return (
      <Gate title="Rush is not available right now.">
        A run needs the database, which is not configured for this deployment.
        Practice, the daily and the trainer all still work.
      </Gate>
    );
  }

  const profile = await ensureProfile();
  if (!profile) {
    return (
      <Gate title="Sign in to run.">
        Rush builds its target from your own pace, which means it needs to know
        whose pace it is.
        <span className="mt-5 block">
          <Link
            href="/timer"
            className="rounded-lg border border-border px-4 py-2 text-xs text-muted transition-colors hover:border-muted-dim hover:text-foreground"
          >
            Practice instead
          </Link>
        </span>
      </Gate>
    );
  }

  // Every event's best, loaded together. Four small indexed reads cost less than
  // a round trip when somebody switches, and switching is the first thing anyone
  // does on a page that offers a choice.
  const bests = Object.fromEntries(
    await Promise.all(
      EVENT_IDS.map(async (id) => {
        const best = await bestRun(profile.id, id);
        return [id, best ? { score: best.score, bestStreak: best.bestStreak } : null] as const;
      }),
    ),
  ) as Record<EventId, { score: number; bestStreak: number } | null>;

  return <RushScreen bests={bests} />;
}

function Gate({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col">
      <SiteHeader active="rush" />
      <div className="flex flex-1 items-center justify-center px-6 pb-24">
        <div className="max-w-md text-center">
          <h1 className="text-2xl font-medium tracking-tight">{title}</h1>
          <p className="mt-4 text-sm leading-relaxed text-muted">{children}</p>
        </div>
      </div>
    </main>
  );
}
