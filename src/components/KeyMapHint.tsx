"use client";

import { KEY_GROUPS } from "@/lib/keyMap";

/**
 * The keyboard layout, always on screen while learning.
 *
 * Hiding this behind a "help" button would be the obvious mistake: a beginner
 * needs it visible on literally every move for their first few sessions, and the
 * cost of looking it up is the reason most people bounce off keyboard cubing.
 * The key that was just pressed lights up, so the mapping is learned by use rather
 * than memorised up front.
 */
export function KeyMapHint({ activeCode, compact = false }: { activeCode: string | null; compact?: boolean }) {
  return (
    <div
      className={`grid w-full gap-x-6 gap-y-5 ${
        compact ? "grid-cols-1" : "max-w-4xl grid-cols-2 md:grid-cols-4"
      }`}
    >
      {KEY_GROUPS.map((group) => (
        <div key={group.title} className="flex flex-col gap-2">
          <div>
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-dim">
              {group.title}
            </h3>
            <p className="mt-1 text-xs leading-snug text-muted-dim">{group.hint}</p>
          </div>
          <div className="flex flex-wrap gap-1">
            {group.bindings.map((b) => {
              const active = b.code === activeCode;
              return (
                <span
                  key={`${b.code}-${b.move}`}
                  className={`flex items-center gap-1 rounded border px-1.5 py-0.5 text-xs transition-colors duration-75 ${
                    active
                      ? "border-ready/50 bg-ready/15 text-ready"
                      : "border-border text-muted-dim"
                  }`}
                >
                  <kbd className="font-mono font-medium">{b.label}</kbd>
                  <span className="text-muted-dim">→</span>
                  <span className="font-mono">{b.move}</span>
                </span>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
