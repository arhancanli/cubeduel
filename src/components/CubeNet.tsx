import Link from "next/link";

import { Glyph } from "@/components/Glyph";
import { FACES, stickerVar } from "@/lib/modes";

/**
 * The six modes, unfolded like a cube.
 *
 * A real net in the standard colour scheme — white above green, yellow below,
 * orange, red and blue around the sides — so the layout says something true: the
 * modes are six faces of one thing. Solve sits on the front face, in the middle,
 * because it is where everybody starts.
 *
 * Each face is a plain link. The net is decoration only in its arrangement; the
 * reading order (Daily, Race, Solve, Ranked, Duel, Rush) is the order of the
 * grid, so keyboard and screen reader users move through it top to bottom.
 */
export function CubeNet({ className = "" }: { className?: string }) {
  return (
    <nav aria-label="Modes" className={`w-full ${className}`}>
      <ul className="grid grid-cols-4 grid-rows-3 gap-1.5 sm:gap-2.5">
        {FACES.map((face) => (
          <li
            key={face.key}
            style={{ gridColumn: face.cell[0] + 1, gridRow: face.cell[1] + 1 }}
            className="aspect-square min-w-0"
          >
            <Link
              href={face.href}
              title={face.blurb}
              style={{ "--face": stickerVar(face.sticker) } as React.CSSProperties}
              className="net-face group flex h-full flex-col rounded-xl border border-border bg-surface p-2.5 transition-[transform,border-color,background-color] duration-200 hover:-translate-y-0.5 hover:border-[var(--face)] hover:bg-surface-hi sm:rounded-2xl sm:p-4"
            >
              <span className="flex items-start justify-between">
                <Glyph pattern={face.glyph} sticker={face.sticker} size={26} className="sm:size-8" />
                <span aria-hidden="true" className="hidden font-mono text-xs text-muted-dim sm:inline">
                  {face.face}
                </span>
              </span>
              <span className="mt-auto flex flex-col gap-1">
                <span
                  aria-hidden="true"
                  className="hidden h-1 w-7 rounded-full sm:block"
                  style={{ background: stickerVar(face.sticker) }}
                />
                <span className="font-display text-[15px] font-bold leading-tight sm:text-xl">{face.label}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
