import Link from "next/link";

import { formatMs } from "@/lib/format";
import { effectiveMs } from "@/lib/stats";
import type { Placed } from "@/lib/weekly";

/**
 * A week's results the way a competition prints them: place, name, average,
 * best, and the five, with the dropped best and worst in brackets.
 */
export function WeeklyBoardTable({ placed, you }: { placed: Placed[]; you?: string | null }) {
  return (
    <ol data-testid="weekly-board" className="divide-y divide-border overflow-hidden rounded-2xl border border-border">
      {placed.map((entry) => (
        <li
          key={entry.handle}
          data-you={entry.handle === you || undefined}
          className={`grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-4 py-3 sm:grid-cols-[2rem_minmax(0,1fr)_auto_auto] ${
            entry.handle === you ? "bg-surface-hi" : "bg-surface"
          }`}
        >
          <Place place={entry.place} />
          <Link href={`/u/${entry.handle}`} className="min-w-0 truncate text-sm hover:text-foreground">
            <span className="font-semibold">{entry.displayName}</span>
            <span className="ml-2 text-muted-dim">{entry.handle === you ? "you" : `@${entry.handle}`}</span>
          </Link>
          <span className="col-start-2 row-start-2 flex gap-2 font-mono text-[11px] text-muted-dim sm:col-start-auto sm:row-start-auto">
            {bracketed(entry).map((text, i) => (
              <span key={i} className="tnum">
                {text}
              </span>
            ))}
          </span>
          <span className="col-start-3 row-span-2 row-start-1 flex flex-col items-end sm:col-start-auto sm:row-span-1 sm:row-start-auto">
            <span className="tnum font-display text-lg font-bold">
              {entry.averageMs === null ? "DNF" : formatMs(entry.averageMs, { truncate: false })}
            </span>
            <span className="tnum text-[11px] text-muted-dim">best {entry.bestMs === null ? "DNF" : formatMs(entry.bestMs)}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

/** The five, with the dropped best and worst in brackets, as results are printed. */
function bracketed(entry: Placed): string[] {
  const values = entry.results.map((r) => effectiveMs(r));
  const order = values
    .map((v, i) => ({ v: v ?? Infinity, i }))
    .sort((a, b) => a.v - b.v);
  const best = order[0].i;
  const worst = order[order.length - 1].i;
  return entry.results.map((r, i) => {
    const v = values[i];
    const text = v === null ? "DNF" : formatMs(v);
    return i === best || i === worst ? `(${text})` : text;
  });
}

function Place({ place }: { place: number }) {
  const podium: Record<number, string> = { 1: "var(--sticker-yellow)", 2: "var(--sticker-white)", 3: "var(--sticker-orange)" };
  const colour = podium[place];
  if (!colour) return <span className="tnum text-center text-sm text-muted-dim">{place}</span>;
  return (
    <span
      className="tnum grid size-8 place-items-center rounded-lg font-display text-sm font-extrabold text-background"
      style={{ background: colour }}
    >
      {place}
    </span>
  );
}
