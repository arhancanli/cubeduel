import { ImageResponse } from "next/og";

import { profileStats } from "@/lib/server/boards";
import { profileByHandle } from "@/lib/server/profiles";
import { isDatabaseConfigured } from "@/lib/server/supabase";
import { Card, OG_CONTENT_TYPE, OG_SIZE } from "@/lib/ogCard";
import { profileCardContent } from "@/lib/shareCards";

/**
 * A player's card.
 *
 * The rating is the part worth being careful about. A card is the most
 * screenshotted surface this site has and the least likely to carry its
 * context, so it follows the same rule as every other place a rating appears:
 * an unestablished one is written as unrated, and an established one brings
 * its ± with it.
 */
export const dynamic = "force-dynamic";

export const alt = "A speedcuber's rating and verified solves on cubeduel";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function ProfileOpengraphImage({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle } = await params;

  const profile = isDatabaseConfigured() ? await profileByHandle(handle).catch(() => null) : null;
  const stats = profile ? await profileStats(profile.id).catch(() => null) : null;

  return new ImageResponse(
    (
      <Card
        {...profileCardContent(
          profile && stats
            ? {
                displayName: profile.display_name,
                handle: profile.handle,
                event: "333",
                rating: stats.rating,
                deviation: stats.deviation,
                established: stats.established,
                rank: stats.rank,
                rankedSolves: stats.rankedSolves,
                bestSingleMs: stats.bestSingleMs,
              }
            : null,
        )}
      />
    ),
    size,
  );
}
