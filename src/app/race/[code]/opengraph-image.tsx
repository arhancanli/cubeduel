import { ImageResponse } from "next/og";

import { Card, OG_CONTENT_TYPE, OG_SIZE } from "@/lib/ogCard";
import { isRaceCode } from "@/lib/race";
import { raceCard } from "@/lib/server/races";
import { isDatabaseConfigured } from "@/lib/server/supabase";
import { raceCardContent } from "@/lib/shareCards";

/**
 * The card a chat app draws when somebody pastes a race link.
 *
 * This is the invitation. A race is two people agreeing to solve the same cube
 * at the same moment, and the link is how they agree — so the preview has to
 * say who is asking and what the rules are, without saying anything about the
 * cube itself. `raceCard` reads without settling the race: a link preview is a
 * robot looking at a message, and a robot should not be able to declare
 * somebody's race abandoned by looking at it.
 */
export const dynamic = "force-dynamic";

export const alt = "A live speedcubing race on cubeduel";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function RaceOpengraphImage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;

  // A card is never an error page: whatever went wrong, the link still gets a
  // preview that says what this site is.
  const race =
    isRaceCode(code) && isDatabaseConfigured() ? await raceCard(code).catch(() => null) : null;

  return new ImageResponse(<Card {...raceCardContent(race)} />, size);
}
