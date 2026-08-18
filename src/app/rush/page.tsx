import type { Metadata } from "next";
import Link from "next/link";

import { RushScreen } from "@/components/RushScreen";
import { SiteHeader } from "@/components/SiteHeader";
import { DEFAULT_EVENT } from "@/lib/events";
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

  const best = await bestRun(profile.id, DEFAULT_EVENT);
  return (
    <RushScreen
      event={DEFAULT_EVENT}
      best={best ? { score: best.score, bestStreak: best.bestStreak } : null}
    />
  );
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
