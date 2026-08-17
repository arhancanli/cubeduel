import { ImageResponse } from "next/og";

import dailies from "@/data/dailies.json";
import { todayNumber, utcDayKey } from "@/lib/daily";

/**
 * The card for the daily, which is the link people actually share.
 *
 * It carries the day number and nothing about the scramble. That is deliberate:
 * the daily is a contest, and a preview that leaked the puzzle would let anyone
 * study it from the group chat before opening the page.
 */

/**
 * Never prerendered.
 *
 * Without this the card is generated once at build time and every share for the
 * rest of the deployment's life advertises the day it happened to be built on.
 * The build output says `○ (Static)` and the image looks perfectly correct,
 * which is what makes it worth stating rather than discovering.
 */
export const dynamic = "force-dynamic";

export const alt = "cubeduel daily — one scramble, one attempt, the same cube for everyone";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const BACKGROUND = "#0a0a0b";
const FOREGROUND = "#f2f2f3";
const MUTED = "#a3a3ad";
const DIM = "#85858f";

export default function DailyOpengraphImage() {
  // Rendered per request, so the number is today's rather than the day of the
  // last deploy.
  const day = todayNumber(dailies.start);
  const dayKey = utcDayKey();

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: BACKGROUND,
          color: FOREGROUND,
          padding: 72,
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div style={{ fontSize: 30, color: DIM, letterSpacing: 2 }}>cubeduel</div>
          {/*
            One string child, not two. Satori counts JSX children as nodes, so
            `Daily #{day}` is a div with two of them and it demands an explicit
            display — which surfaces as a build-time prerender failure, not a
            runtime one.
          */}
          <div style={{ fontSize: 92, lineHeight: 1, letterSpacing: -3 }}>
            {`Daily #${day}`}
          </div>
          <div style={{ fontSize: 34, color: MUTED, lineHeight: 1.35, maxWidth: 860 }}>
            One scramble. One attempt. The same cube for everyone, resetting at
            midnight UTC.
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 24, color: DIM }}>
          <div style={{ display: "flex" }}>{dayKey}</div>
          <div style={{ display: "flex" }}>cubeduel.vercel.app/daily</div>
        </div>
      </div>
    ),
    size,
  );
}
