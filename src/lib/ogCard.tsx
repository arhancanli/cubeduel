import type { ReactElement } from "react";

/**
 * The look every share card has, in one place.
 *
 * A link to this site is mostly seen before the site is: pasted into a group
 * chat, a Discord server, a reply. What that preview says is the whole first
 * impression, and for a race link it is the invitation itself. Four routes draw
 * one — a race, a solve, a profile, a challenge — and they share this so they
 * read as one product rather than four.
 *
 * ## Satori, and the two rules it enforces quietly
 *
 * These render through Satori, which is not a browser. Two things it insists on,
 * both of which fail at build or request time rather than looking slightly off:
 *
 *   - **Every element with more than one child needs an explicit `display`.**
 *     `Day {n}` is two children, and a div holding it without `display: flex`
 *     is an error. Interpolating one string avoids the question entirely.
 *   - **No inherited layout.** There is no block layout to fall back on, so
 *     every container here says flex and says its direction.
 *
 * ## What a card may say
 *
 * Nothing the person sharing has not already shared, and never the scramble. A
 * race and a challenge are contests on one cube, and a preview that showed it
 * would let whoever opened the link study the solve in the group chat. That is
 * the same rule the daily's card has always followed.
 */

export const OG_SIZE = { width: 1200, height: 630 };
export const OG_CONTENT_TYPE = "image/png";

export const COLOURS = {
  background: "#0a0a0b",
  foreground: "#f2f2f3",
  muted: "#a3a3ad",
  dim: "#85858f",
  border: "#26262c",
  accent: "#7dd3a0",
};

interface CardProps {
  /** The small word at the top left: what kind of thing this link is. */
  kind: string;
  /** The line people read first, at the size they read it from a thumbnail. */
  headline: string;
  /** One line under it, or nothing. */
  subheading?: string | null;
  /** Up to three figures along the bottom, each a value and what it is. */
  figures?: { value: string; label: string }[];
  /** Replaces the figures when a card has something else to show there. */
  footnote?: string | null;
}

/**
 * How big the headline is, from how much of it there is.
 *
 * A solve card's headline is a time — four characters that are the entire point
 * of the link — and at one fixed size it sat in the corner looking incidental.
 * Two names and the word between them, at that same size, ran to three lines.
 * The number that matters gets to be big; the sentence that matters gets to
 * fit.
 */
function headlineSize(headline: string): number {
  if (headline.length <= 8) return 118;
  if (headline.length <= 20) return 88;
  return 72;
}

/**
 * One card, laid out the same way every time: what it is, what happened, and
 * the numbers.
 */
export function Card({ kind, headline, subheading, figures = [], footnote }: CardProps): ReactElement {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        background: COLOURS.background,
        color: COLOURS.foreground,
        padding: 72,
        fontFamily: "sans-serif",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <div style={{ display: "flex", fontSize: 28, color: COLOURS.dim, letterSpacing: 2 }}>
          {kind}
        </div>
        <div style={{ display: "flex", fontSize: headlineSize(headline), lineHeight: 1.1 }}>
          {headline}
        </div>
        {subheading ? (
          <div style={{ display: "flex", fontSize: 32, color: COLOURS.muted, lineHeight: 1.3 }}>
            {subheading}
          </div>
        ) : null}
      </div>

      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
        {figures.length > 0 ? (
          <div style={{ display: "flex", gap: 56 }}>
            {figures.map((figure) => (
              <div key={figure.label} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ display: "flex", fontSize: 46 }}>{figure.value}</div>
                <div style={{ display: "flex", fontSize: 24, color: COLOURS.dim }}>{figure.label}</div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ display: "flex", fontSize: 28, color: COLOURS.muted }}>{footnote ?? ""}</div>
        )}

        <div
          style={{
            display: "flex",
            fontSize: 24,
            color: COLOURS.dim,
            borderTop: `1px solid ${COLOURS.border}`,
            paddingTop: 14,
          }}
        >
          cubeduel.vercel.app
        </div>
      </div>
    </div>
  );
}
