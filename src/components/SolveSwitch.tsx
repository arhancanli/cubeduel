import Link from "next/link";

import { Glyph } from "@/components/Glyph";
import { faceFor } from "@/lib/modes";

export type SolveWay = "timer" | "keyboard" | "smart";

const WAYS: { key: SolveWay; href: string; label: string; hint: string }[] = [
  { key: "timer", href: "/timer", label: "Timer", hint: "Your real cube, spacebar to start" },
  { key: "keyboard", href: "/play", label: "Keyboard", hint: "Turn a cube on screen" },
  { key: "smart", href: "/cube", label: "Smart cube", hint: "Bluetooth cube, every turn recorded" },
];

/**
 * The three ways to solve, as one switch at the top of each solving screen.
 *
 * They used to be three unrelated pages with unrelated names, and nothing on
 * any of them said the other two existed. Named by what is in your hands, with
 * one line under each saying what that means, so a first visit is a choice
 * rather than a guess.
 */
export function SolveSwitch({ active, className = "" }: { active: SolveWay; className?: string }) {
  const solve = faceFor("solve");
  return (
    <nav aria-label="How you solve" className={`w-full ${className}`}>
      <ul className="grid grid-cols-3 gap-1 rounded-2xl border border-border bg-surface p-1">
        {WAYS.map((way) => {
          const current = way.key === active;
          return (
            <li key={way.key} className="min-w-0">
              <Link
                href={way.href}
                aria-current={current ? "page" : undefined}
                className={`flex h-full flex-col items-center gap-0.5 rounded-xl px-2 py-2 text-center transition-colors sm:flex-row sm:gap-2.5 sm:px-3 sm:text-left ${
                  current ? "bg-surface-hi text-foreground" : "text-muted hover:bg-surface-hi/60 hover:text-foreground"
                }`}
              >
                {current ? <Glyph pattern={solve.glyph} sticker={solve.sticker} size={16} className="hidden sm:block" /> : null}
                <span className="flex min-w-0 flex-col">
                  <span className="text-sm font-semibold">{way.label}</span>
                  <span className="hidden truncate text-[11px] text-muted-dim md:block">{way.hint}</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
