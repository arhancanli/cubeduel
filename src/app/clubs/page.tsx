import type { Metadata } from "next";

import { ClubsScreen, type ClubSummary } from "@/components/ClubsScreen";
import { normaliseJoinCode } from "@/lib/club";
import { clubsFor, roleIn } from "@/lib/server/clubs";
import { ensureProfile } from "@/lib/server/profiles";
import { isDatabaseConfigured } from "@/lib/server/supabase";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Clubs · cubeduel",
  description:
    "A board for the people you actually cube with — your school, your university, your group chat. Ranked by the same verified solves as the global ladder.",
};

export default async function ClubsPage(props: PageProps<"/clubs">) {
  // `/clubs?code=…` arrives with the code already in the box. It is two things
  // at once: an invite link that can be pasted into a group chat, and the
  // address the join form itself goes to when it is submitted before the page's
  // script has loaded — a plain form submission, which used to reload this page
  // and throw the code away, so a quick tap on a slow phone did nothing at all.
  const { code } = await props.searchParams;
  const initialCode = typeof code === "string" ? (normaliseJoinCode(code) ?? "") : "";

  if (!isDatabaseConfigured()) {
    return <ClubsScreen clubs={[]} signedIn={false} initialCode={initialCode} />;
  }

  // `ensureProfile`, not `currentProfile`. A profile is created on first sight,
  // so somebody who has just signed up has a session and no profile yet — and
  // reading only the existing one made this page tell a signed-in person that
  // they needed an account. Every signed-in page that can be somebody's FIRST
  // has to create rather than read.
  const profile = await ensureProfile();
  if (!profile) return <ClubsScreen clubs={[]} signedIn={false} initialCode={initialCode} />;

  let clubs: ClubSummary[] = [];
  try {
    const mine = await clubsFor(profile.id);
    clubs = await Promise.all(
      mine.map(async (club) => ({
        id: club.id,
        slug: club.slug,
        name: club.name,
        memberCount: club.memberCount,
        joinCode: club.joinCode,
        role: (await roleIn(club.id, profile.id)) ?? "member",
      })),
    );
  } catch {
    // `clubsFor` throws rather than returning an empty list, because "you are in
    // no clubs" and "the database is unreachable" are opposite facts and the
    // first is a thing somebody would act on. Rendering the page with an empty
    // list here is the same mistake one level up, so the page says nothing about
    // membership rather than something false — the join and create forms still
    // work, and a retry costs a refresh.
    clubs = [];
  }

  return <ClubsScreen clubs={clubs} signedIn initialCode={initialCode} />;
}
