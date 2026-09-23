import type { Metadata } from "next";

import { RaceStart } from "@/components/RaceStart";
import { PageHero } from "@/components/PageHero";
import { SiteHeader } from "@/components/SiteHeader";
import { ensureProfile } from "@/lib/server/profiles";
import { isDatabaseConfigured } from "@/lib/server/supabase";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Race a friend · cubeduel",
  description:
    "A live speedcubing race: send a link, press ready together, and solve the same scramble at the same moment — with each other's progress on screen and both solves checked by the server.",
};

/**
 * `ensureProfile`, not `currentProfile`: somebody who has just signed up has a
 * session and no profile until a page creates one, and reading only an existing
 * profile told exactly that person — arriving from a race link — to sign in.
 * `/clubs` made the same mistake first; the browser suite for races caught it
 * here before anybody did.
 */
export default async function RacePage() {
  const signedIn = isDatabaseConfigured() ? Boolean(await ensureProfile().catch(() => null)) : false;
  return (
    <main className="flex min-h-dvh flex-col">
      <SiteHeader active="race" />
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center gap-10 px-4 pb-24 pt-6 sm:px-6 lg:pt-14">
        <PageHero face="race" eyebrow="Race · live" title="Race a friend" center>
          <p>
            Send them a link. When you are both ready, a countdown you share ends with the same scramble
            appearing on both screens, and you watch each other get through the cross, the pairs and the
            last layer as it happens. The faster solve wins — inspection is yours, fifteen seconds of
            it, as in competition — and the server checks both solves before it names a winner.
          </p>
        </PageHero>
        <RaceStart signedIn={signedIn} />
        <p className="max-w-md text-center text-xs leading-relaxed text-muted-dim">
          Races do not move your rating: speed does not depend on being raced. The ladder is{" "}
          <a href="/ranked" className="underline underline-offset-4">
            ranked
          </a>
          .
        </p>
      </div>
    </main>
  );
}
