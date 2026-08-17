import type { Metadata } from "next";
import Link from "next/link";

import { DuelScreen } from "@/components/DuelScreen";
import { SiteHeader } from "@/components/SiteHeader";
import { duelRecord } from "@/lib/server/duels";
import { ensureProfile } from "@/lib/server/profiles";
import { isDatabaseConfigured } from "@/lib/server/supabase";

export const metadata: Metadata = {
  title: "Duel — cubeduel",
  description:
    "Race a bot that replays a real solution to the same scramble, at a pace fixed before you start.",
};

// Never prerendered: without this the signed-out gate is baked into the build
// and served to everyone forever.
export const dynamic = "force-dynamic";

export default async function DuelPage() {
  if (!isDatabaseConfigured()) {
    return (
      <Gate title="Duels are not available right now.">
        Racing needs the database, which is not configured for this deployment.
        Practice, the daily and the trainer all still work.
      </Gate>
    );
  }

  const profile = await ensureProfile();
  if (!profile) {
    return (
      <Gate title="Sign in to duel.">
        A result has to belong to someone. Practice mode needs no account and is
        the same cube.
        <span className="mt-5 block">
          <Link
            href="/play"
            className="rounded-lg border border-border px-4 py-2 text-xs text-muted transition-colors hover:border-muted-dim hover:text-foreground"
          >
            Practice instead
          </Link>
        </span>
      </Gate>
    );
  }

  const record = await duelRecord(profile.id);
  return <DuelScreen record={{ wins: record.wins, losses: record.losses }} />;
}

function Gate({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col">
      <SiteHeader active="duel" />
      <div className="flex flex-1 items-center justify-center px-6 pb-24">
        <div className="max-w-md text-center">
          <h1 className="text-2xl font-medium tracking-tight">{title}</h1>
          <p className="mt-4 text-sm leading-relaxed text-muted">{children}</p>
        </div>
      </div>
    </main>
  );
}
