import { ImageResponse } from "next/og";

import { Card, OG_CONTENT_TYPE, OG_SIZE } from "@/lib/ogCard";
import { solvePage } from "@/lib/server/solvePage";
import { isDatabaseConfigured } from "@/lib/server/supabase";
import { solveCardContent } from "@/lib/shareCards";

/**
 * The card for a solve permalink.
 *
 * A time on its own is a claim; this site's whole argument is that a time comes
 * with the moves that produced it, replayed on a model of the cube. So the card
 * carries the verification alongside the number — and says when it is missing,
 * rather than leaving the word out and letting the absence go unnoticed.
 */
export const dynamic = "force-dynamic";

export const alt = "A verified speedcubing solve on cubeduel";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function SolveOpengraphImage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const solve = isDatabaseConfigured() ? await solvePage(id).catch(() => null) : null;

  return new ImageResponse(
    (
      <Card
        {...solveCardContent(
          solve
            ? {
                event: solve.event,
                durationMs: solve.durationMs,
                penalty: solve.penalty,
                displayName: solve.displayName,
                handle: solve.handle,
                moveCount: solve.moveCount,
                tps: solve.tps,
                verified: solve.verified,
                mode: solve.mode,
              }
            : null,
        )}
      />
    ),
    size,
  );
}
