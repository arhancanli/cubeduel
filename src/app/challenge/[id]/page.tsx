import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ChallengeScreen } from "@/components/ChallengeScreen";
import { ModeGate } from "@/components/ModeGate";
import { listChallenges } from "@/lib/server/challenges";
import { ensureProfile } from "@/lib/server/profiles";
import { isDatabaseConfigured } from "@/lib/server/supabase";

export const metadata: Metadata = {
  title: "Challenge",
  description: "Head to head on the same scramble.",
};

export const dynamic = "force-dynamic";

export default async function ChallengePage({ params }: PageProps<"/challenge/[id]">) {
  const { id } = await params;

  if (!isDatabaseConfigured()) {
    return <Gate title="Challenges are not available right now." />;
  }

  const profile = await ensureProfile();
  if (!profile) {
    return (
      <Gate title="Sign in to answer a challenge." signIn={`/challenge/${id}`}>
        A head-to-head result has to belong to two people.
      </Gate>
    );
  }

  // Read through the same redacting path the API uses, so this page cannot
  // render something the wire would have withheld.
  const challenge = (await listChallenges(profile.id, 200)).find((c) => c.id === id);

  // A challenge belonging to somebody else does not exist, as far as this player
  // is concerned. Distinguishing "forbidden" from "missing" leaks whether an id
  // is real.
  if (!challenge) notFound();

  if (!challenge.awaitingYou) {
    return (
      <Gate
        title={
          challenge.status === "pending"
            ? "You have already solved this one."
            : "This challenge is over."
        }
      >
        {challenge.status === "pending"
          ? `Waiting on ${challenge.them.handle}. Neither time is shown until you have both finished.`
          : "Your record is on the duel page."}
        <span className="mt-5 block">
          <Link
            href="/duel"
            className="rounded-lg border border-border px-4 py-2 text-xs text-muted transition-colors hover:border-muted-dim hover:text-foreground"
          >
            Back to duels
          </Link>
        </span>
      </Gate>
    );
  }

  return (
    <ChallengeScreen
      challengeId={challenge.id}
      opponentHandle={challenge.them.handle}
      alreadyStarted={challenge.scramble !== null}
    />
  );
}

function Gate({
  title,
  children,
  signIn,
}: {
  title: string;
  children?: React.ReactNode;
  signIn?: string;
}) {
  return (
    <ModeGate face="duel" active="duel" title={title} signIn={signIn}>
      {children}
    </ModeGate>
  );
}
