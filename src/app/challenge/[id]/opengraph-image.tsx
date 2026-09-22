import { ImageResponse } from "next/og";

import { challengeCard } from "@/lib/server/challenges";
import { isDatabaseConfigured } from "@/lib/server/supabase";
import { Card, OG_CONTENT_TYPE, OG_SIZE } from "@/lib/ogCard";
import { challengeCardContent } from "@/lib/shareCards";

/**
 * The card for a challenge link.
 *
 * It matters most for an open challenge, which is a link worth posting where
 * strangers will see it: the preview has to say that anybody may take it, or it
 * reads as somebody else's private game. It names whoever left the challenge and
 * nobody else — anybody with the id can fetch this — and never the scramble.
 */
export const dynamic = "force-dynamic";

export const alt = "A head-to-head speedcubing challenge on cubeduel";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function ChallengeOpengraphImage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const challenge = isDatabaseConfigured() ? await challengeCard(id).catch(() => null) : null;

  return new ImageResponse(<Card {...challengeCardContent(challenge)} />, size);
}
