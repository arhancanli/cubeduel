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
          <p>The same scramble on two screens, at the same moment. Fastest solve wins.</p>
        </PageHero>
        <RaceStart signedIn={signedIn} />
        {/* A real sequence, so it is numbered: this is the order it happens in. */}
        <ol className="grid w-full gap-3 sm:grid-cols-3" aria-label="How a race works">
          {[
            ["Send a link", "Start a race and share the link. Your friend opens it — no download."],
            ["Count down together", "When you are both ready, one countdown starts on both screens."],
            ["Race the same scramble", "You see each other's progress live. The server checks both solves before naming a winner."],
          ].map(([title, body], i) => (
            <li key={title} className="flex flex-col gap-1.5 rounded-2xl border border-border bg-surface px-4 py-4">
              <span className="tnum text-xs font-semibold text-sticker-orange">{i + 1}</span>
              <span className="text-sm font-semibold">{title}</span>
              <span className="text-xs leading-relaxed text-muted">{body}</span>
            </li>
          ))}
        </ol>
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
