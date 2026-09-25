import { formatMs } from "@/lib/format";
import { sessionChart } from "@/lib/sessionChart";
import type { Solve } from "@/lib/types";

const W = 280;
const H = 84;

/** The session at a glance: every solve, the rolling ao5 over it, the best marked. */
export function SessionChart({ solves }: { solves: readonly Solve[] }) {
  const chart = sessionChart(solves, W, H);
  if (!chart) return null;
  const line = chart.ao5.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  return (
    <figure className="flex flex-col gap-2 rounded-2xl border border-border bg-surface px-4 py-3" data-testid="session-chart">
      <figcaption className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-dim">
        <span>This session</span>
        <span className="flex items-center gap-3 normal-case tracking-normal">
          <span className="flex items-center gap-1">
            <span className="inline-block size-1.5 rounded-full bg-muted-dim" /> solve
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-0.5 w-3 rounded bg-sticker-green" /> ao5
          </span>
        </span>
      </figcaption>
      <svg
        viewBox={`-4 -4 ${W + 8} ${H + 8}`}
        className="h-24 w-full overflow-visible"
        role="img"
        aria-label={`${chart.points.length} solves${chart.best ? `, best ${formatMs(chart.best.ms)}` : ""}`}
      >
        {chart.points.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={2} className="fill-muted-dim" />
        ))}
        {line ? <path d={line} fill="none" strokeWidth={1.75} className="stroke-sticker-green" /> : null}
        {chart.dnfs.map((x, i) => (
          <line key={`d${i}`} x1={x} x2={x} y1={H - 3} y2={H + 3} strokeWidth={1.5} className="stroke-danger" />
        ))}
        {chart.best ? <circle cx={chart.best.x} cy={chart.best.y} r={3.5} className="fill-ready" /> : null}
      </svg>
    </figure>
  );
}
