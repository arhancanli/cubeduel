import type { Metadata } from "next";
import Link from "next/link";

import { DuelScreen } from "@/components/DuelScreen";
import { SiteHeader } from "@/components/SiteHeader";
import { listChallenges } from "@/lib/server/challenges";
import { duelRecord } from "@/lib/server/duels";
import { MissingTableError } from "@/lib/server/schema";
import { ensureProfile } from "@/lib/server/profiles";
import { isDatabaseConfigured } from "@/lib/server/supabase";

export const metadata: Metadata = {
  title: "Duel",
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

  let record: Awaited<ReturnType<typeof duelRecord>>;
  let challenges: Awaited<ReturnType<typeof listChallenges>>;

  try {
    [record, challenges] = await Promise.all([
      duelRecord(profile.id),
      listChallenges(profile.id),
    ]);
  } catch (error) {
    // Only a missing table is caught. Applying `0001` and stopping is the most
    // likely thing to go wrong when cloning this repo, and without this the page
    // is a stack trace rather than an instruction. Every other failure is
    // rethrown, because an outage that renders as a tidy explanation is an
    // outage nobody investigates.
    if (!(error instanceof MissingTableError)) throw error;
    return (
      <Gate title="Duels need a migration that has not been applied.">
        The <code className="font-mono text-foreground">{error.table}</code>{" "}
        table does not exist in this database. Apply everything in{" "}
        <code className="font-mono text-foreground">supabase/migrations</code> in
        filename order — all three are needed.
      </Gate>
    );
  }

  return (
    <DuelScreen
      record={{ wins: record.wins, losses: record.losses }}
      challenges={challenges}
    />
  );
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
