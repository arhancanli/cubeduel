/**
 * The rating over time, as a plain SVG line.
 *
 * Deliberately not a charting library. This draws one series with no axes, no
 * tooltips and no interaction, and every library that could do it costs more in
 * bundle size than the whole feature is worth on a page that is otherwise text.
 *
 * No `"use client"`: it renders identical markup from identical props, so it
 * belongs in the server component that already has the data.
 */

export interface RatingPoint {
  at: string;
  rating: number;
}

const WIDTH = 640;
const HEIGHT = 120;
const PAD = 6;

export function RatingHistory({ points }: { points: RatingPoint[] }) {
  // One point is not a history, and drawing it as a flat line would imply a
  // stability that a single measurement cannot support.
  if (points.length < 2) return null;

  const values = points.map((p) => p.rating);
  const min = Math.min(...values);
  const max = Math.max(...values);

  // A player whose rating has barely moved would otherwise get a span of ~0 and
  // a line that swings wildly on rounding noise. Padding the range flattens it
  // into the honest picture: not much happened.
  const span = Math.max(max - min, 60);
  const mid = (max + min) / 2;
  const low = mid - span / 2;

  const x = (i: number) =>
    PAD + (i / (points.length - 1)) * (WIDTH - PAD * 2);
  const y = (value: number) =>
    HEIGHT - PAD - ((value - low) / span) * (HEIGHT - PAD * 2);

  const path = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.rating).toFixed(1)}`)
    .join(" ");

  const first = points[0];
  const last = points[points.length - 1];
  const change = Math.round(last.rating - first.rating);

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="h-28 w-full"
        role="img"
        aria-label={`Rating from ${Math.round(first.rating)} to ${Math.round(
          last.rating,
        )} over ${points.length} rating updates.`}
        preserveAspectRatio="none"
      >
        <path
          d={path}
          fill="none"
          stroke="var(--bar)"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
        <circle cx={x(points.length - 1)} cy={y(last.rating)} r="3" fill="var(--foreground)" />
      </svg>

      <div className="mt-3 flex flex-wrap items-baseline justify-between gap-2 text-xs text-muted-dim">
        <span>
          {points.length} rating updates · low {Math.round(min)} · high{" "}
          {Math.round(max)}
        </span>
        <span className={change > 0 ? "text-ready" : change < 0 ? "text-danger" : ""}>
          {change > 0 ? "+" : ""}
          {change} overall
        </span>
      </div>
    </div>
  );
}
