import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ClubBoard } from "@/components/ClubBoard";
import { SiteHeader } from "@/components/SiteHeader";
import { DEFAULT_EVENT } from "@/lib/events";
import { clubBySlug, roleIn, standingsFor } from "@/lib/server/clubs";
import { currentProfile } from "@/lib/server/profiles";
import { isDatabaseConfigured } from "@/lib/server/supabase";

/**
 * A club's public page.
 *
 * Public deliberately, and that is the whole distribution mechanism: a captain
 * pastes this link into a group chat, and everybody who opens it sees a real
 * board with real names on it before being asked for anything. A page that
 * demanded an account first would be a link nobody clicks twice.
 *
 * The invite code is shown only to members, because it is the one thing on here
 * that grants something.
 */
export const dynamic = "force-dynamic";

export async function generateMetadata(props: PageProps<"/c/[slug]">): Promise<Metadata> {
  if (!isDatabaseConfigured()) return { title: "Club · cubeduel" };
  const { slug } = await props.params;
  const club = await clubBySlug(slug);
  if (!club) return { title: "Club · cubeduel" };

  return {
    title: `${club.name} · cubeduel`,
    description:
      club.bio ??
      `${club.name} on cubeduel — ${club.memberCount} member${club.memberCount === 1 ? "" : "s"}, ranked by verified solves.`,
  };
}

export default async function ClubPage(props: PageProps<"/c/[slug]">) {
  const { slug } = await props.params;

  if (!isDatabaseConfigured()) {
    return (
      <Shell>
        <p className="text-sm text-muted">Clubs are not configured for this deployment.</p>
      </Shell>
    );
  }

  const club = await clubBySlug(slug);
  if (!club) notFound();

  const profile = await currentProfile();
  const role = profile ? await roleIn(club.id, profile.id) : null;

  let standings;
  try {
    standings = await standingsFor(club.id, DEFAULT_EVENT, "keyboard");
  } catch {
    // Thrown by the loader rather than degraded to an empty list, because "this
    // club has no members" and "the database is unreachable" are opposite facts.
    return (
      <Shell>
        <h1 className="text-2xl tracking-tight">{club.name}</h1>
        <p className="text-sm text-danger">
          The board could not be loaded. This is not the same as the club being
          empty — try again in a moment.
        </p>
      </Shell>
    );
  }

  return (
    <Shell>
      <header className="flex flex-col gap-3">
        <p className="text-xs uppercase tracking-[0.18em] text-muted-dim">Club</p>
        <h1 className="text-3xl leading-tight tracking-tight">{club.name}</h1>
        {club.bio ? (
          <p className="max-w-lg text-sm leading-relaxed text-muted">{club.bio}</p>
        ) : null}
        <p className="font-mono text-xs text-muted-dim">
          /c/{club.slug} · {club.memberCount} member{club.memberCount === 1 ? "" : "s"}
        </p>
      </header>

      {role ? (
        <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface px-5 py-4">
          <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-dim">
            Invite code
          </span>
          <code className="font-mono text-lg tracking-[0.2em]">{club.joinCode}</code>
          <p className="text-xs leading-relaxed text-muted-dim">
            Anyone with this can join. Paste it, or the link to this page, into
            your group chat.
            {role === "owner" ? " You can replace it from your clubs page." : ""}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface px-5 py-4">
          <p className="text-sm text-muted">
            You are not in this club. Joining needs the invite code its members
            have — and an account, so a rating has somebody to belong to.
          </p>
          <Link
            href="/clubs"
            className="btn-go self-start px-5 py-2 text-sm"
          >
            Join a club
          </Link>
        </div>
      )}

      <ClubBoard standings={standings} event={DEFAULT_EVENT} />
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col">
      <SiteHeader active="clubs" />
      <div className="page-frame flex w-full max-w-2xl flex-1 flex-col gap-8 px-4 pb-24 pt-6 sm:px-8 lg:pt-12">
        {children}
      </div>
    </main>
  );
}
