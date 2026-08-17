import type { Metadata } from "next";
import Link from "next/link";

import { SiteHeader } from "@/components/SiteHeader";

export const metadata: Metadata = { title: "Player not found" };

/**
 * A profile URL that resolves to nobody.
 *
 * Worth its own page rather than falling through to the site-wide 404: this
 * address was almost certainly typed or shared by a person, and "no player by
 * that name" is a different and more useful statement than "nothing here".
 * Handles can also be changed, so a stale link is an ordinary occurrence rather
 * than a mistake.
 */
export default function PlayerNotFound() {
  return (
    <main className="flex min-h-dvh flex-col">
      <SiteHeader active="leaderboard" />

      <div className="flex flex-1 items-center justify-center px-6 pb-24">
        <div className="max-w-md text-center">
          <h1 className="text-2xl font-medium tracking-tight">No player by that name.</h1>
          <p className="mt-4 text-sm leading-relaxed text-muted">
            Either the handle is mistyped, or it has been changed since the link
            was shared — a handle is the profile&apos;s address, so renaming
            moves it.
          </p>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/leaderboard"
              className="rounded-lg bg-foreground px-6 py-2.5 text-sm font-medium text-background transition-opacity hover:opacity-90"
            >
              See the leaderboard
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
