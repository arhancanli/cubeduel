import { ImageResponse } from "next/og";

import { ratingForMs } from "@/lib/rating";

/**
 * The card that appears when a link to this site is pasted anywhere.
 *
 * Worth building properly rather than skipping, because the app's main growth
 * mechanic is somebody pasting their daily result into a group chat. Without a
 * card that link renders as a bare grey URL; with one it renders as the product.
 * The share was already designed to survive being pasted — this is the other
 * half of it.
 *
 * Generated rather than a static file so it cannot drift: the rating scale on it
 * is computed by `ratingForMs`, the same function the ladder runs on, so the
 * numbers on the card are the numbers in the app by construction.
 */

export const alt =
  "cubeduel — a speedcubing platform with server-verified solves and a rating you can read in seconds";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Matches globals.css. Repeated rather than imported because this renders in a
// separate image runtime that never loads the stylesheet.
const BACKGROUND = "#0e1320";
const FOREGROUND = "#eef1f6";
const MUTED = "#a1aabb";
const DIM = "#8a93a7";
const BORDER = "#2a344a";

export default function OpengraphImage() {
  const scale = [5, 15, 30].map((seconds) => ({
    seconds,
    rating: Math.round(ratingForMs(seconds * 1000)),
  }));

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
        <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
          <div style={{ fontSize: 30, color: DIM, letterSpacing: 2 }}>cubeduel</div>
          <div style={{ fontSize: 76, lineHeight: 1.05, letterSpacing: -2, maxWidth: 900 }}>
            A rating that actually means something.
          </div>
          <div style={{ fontSize: 30, color: MUTED, lineHeight: 1.4, maxWidth: 880 }}>
            The server issues a scramble nobody has seen, replays your solve to
            prove it happened, and only then does it count.
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
          <div style={{ display: "flex", gap: 56 }}>
            {scale.map((row) => (
              <div
                key={row.seconds}
                style={{ display: "flex", flexDirection: "column", gap: 6 }}
              >
                <div style={{ fontSize: 46 }}>{String(row.rating)}</div>
                <div style={{ fontSize: 24, color: DIM }}>{`${row.seconds}s average`}</div>
              </div>
            ))}
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 24,
              color: DIM,
              borderTop: `1px solid ${BORDER}`,
              paddingTop: 14,
            }}
          >
            cubeduel.vercel.app
          </div>
        </div>
      </div>
    ),
    size,
  );
}
