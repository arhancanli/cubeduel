import type { Metadata } from "next";

import { RankedScreen, type RankedStanding } from "@/components/RankedScreen";
import { ModeGate } from "@/components/ModeGate";
import { EVENT_IDS, type EventId } from "@/lib/events";
import { UNRATED, isEstablished } from "@/lib/rating";
import { ensureProfile } from "@/lib/server/profiles";
import { currentRating, pendingResultCount } from "@/lib/server/ranked";
import { isDatabaseConfigured } from "@/lib/server/supabase";

export const metadata: Metadata = {
  title: "Ranked",
  description:
    "Solve server-issued scrambles for a rating that means something. Every solve is verified against the scramble it was issued for.",
};

/**
 * Never prerendered.
 *
 * Without this the page is statically generated at build time, where there is no
 * signed-in user and no database configured — so the "not available" gate below
 * gets baked into the deployment and served to every visitor forever, while the
 * ladder underneath it works perfectly. The build output says `○ (Static)` and
 * nothing else looks wrong, which is exactly the kind of failure that ships.
 */
export const dynamic = "force-dynamic";

/**
 * Ranked is the one place in the app that requires an account, and it is worth
 * being clear about why: a rating is a claim about a person that persists, and
 * there is nobody to attach it to otherwise. Everything else still works signed
 * out.
 */
export default async function RankedPage() {
  if (!isDatabaseConfigured()) {
    return (
      <Gate title="Ranked is not available right now.">
        The ladder needs its database, which is not configured for this
        deployment. Practice, the daily and your progress all still work.
      </Gate>
    );
  }

  const profile = await ensureProfile();

  if (!profile) {
    return (
      <Gate title="Sign in to play ranked." signIn="/ranked">
        A rating has to belong to someone. Practice mode needs no account and is
        the same cube — the only difference is that nothing there is recorded
        against you.
      </Gate>
    );
  }

  // Every event's standing, loaded together. There are four of them and each is
  // two small indexed reads, so fetching the lot costs less than a round trip
  // would when the player switches — and switching event is the first thing
  // anybody does on a page like this.
  const standings = Object.fromEntries(
    await Promise.all(
      EVENT_IDS.map(async (id) => {
        const [state, gathered] = await Promise.all([
          currentRating(profile.id, id, "keyboard"),
          pendingResultCount(profile.id, id, "keyboard"),
        ]);
        return [
          id,
          {
            rating: state.rating,
            deviation: state.deviation ?? UNRATED.deviation,
            peak: state.peak,
            established: isEstablished(state),
            pendingAttempts: gathered,
          },
        ] as const;
      }),
    ),
  ) as Record<EventId, RankedStanding>;

  return <RankedScreen standings={standings} />;
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
    <ModeGate face="ranked" active="ranked" title={title} signIn={signIn}>
      {children}
    </ModeGate>
  );
}
