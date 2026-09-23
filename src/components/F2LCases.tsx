"use client";

import { useState } from "react";

import { AlgDemo } from "@/components/AlgDemo";

export interface F2LCaseView {
  number: number;
  group: string;
  alg: string;
  moves: number;
}

/**
 * The 41 cases, grouped by where the two pieces start, each opening onto a
 * cube you can step through. One cube at a time: 41 live cubes on one page
 * would be slow on a phone, and you only ever study one case at once.
 */
export function F2LCases({ groups }: { groups: { title: string; note: string; cases: F2LCaseView[] }[] }) {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <div className="flex flex-col gap-12">
      {groups.map((group) => (
        <section key={group.title} className="flex flex-col gap-4" aria-labelledby={`g-${group.title}`}>
          <div className="flex flex-col gap-1">
            <div className="flex items-baseline gap-3">
              <h2 id={`g-${group.title}`} className="text-2xl">{group.title}</h2>
              <span className="tnum text-sm text-muted-dim">{group.cases.length}</span>
            </div>
            <p className="max-w-2xl text-sm leading-relaxed text-muted">{group.note}</p>
          </div>
          <ul className="grid gap-3 md:grid-cols-2">
            {group.cases.map((c) => {
              const isOpen = open === c.number;
              return (
                <li
                  key={c.number}
                  data-testid="f2l-case"
                  className={`flex flex-col gap-3 rounded-2xl border bg-surface p-4 sm:p-5 ${isOpen ? "border-muted-dim/60 md:col-span-2" : "border-border"}`}
                >
                  <div className="flex items-center gap-4">
                    <span className="tnum grid size-10 shrink-0 place-items-center rounded-xl bg-surface-hi font-display text-base font-bold">
                      {c.number}
                    </span>
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <p className="flex flex-wrap gap-x-2 gap-y-1 font-mono text-base">
                        {c.alg.split(" ").map((m, i) => (
                          <span key={`${m}-${i}`}>{m}</span>
                        ))}
                      </p>
                      <span className="text-xs text-muted-dim">{c.moves} moves</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setOpen(isOpen ? null : c.number)}
                      aria-expanded={isOpen}
                      className="btn-secondary shrink-0 px-3.5 py-2 text-sm"
                    >
                      {isOpen ? "Hide" : "Show on a cube"}
                    </button>
                  </div>
                  {isOpen ? (
                    <div className="max-w-md">
                      <AlgDemo alg={c.alg} label={`F2L case ${c.number}`} hold="z2" />
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
