"use client";

import { useState } from "react";

import { AlgDemo } from "@/components/AlgDemo";

interface Move {
  move: string;
  says: string;
}

const GROUPS: { title: string; note: string; moves: Move[] }[] = [
  {
    title: "The six faces",
    note: "A letter alone is that face turned a quarter clockwise — clockwise as you look straight at that face.",
    moves: [
      { move: "R", says: "Right face, clockwise. The front of the right side goes up." },
      { move: "L", says: "Left face, clockwise. The front of the left side goes down." },
      { move: "U", says: "Up (top) face, clockwise. The front of the top goes left." },
      { move: "D", says: "Down (bottom) face, clockwise. The front of the bottom goes right." },
      { move: "F", says: "Front face, clockwise — like turning a steering wheel right." },
      { move: "B", says: "Back face, clockwise as seen from behind — the top of it goes left as you look from the front." },
    ],
  },
  {
    title: "Prime and double",
    note: "An apostrophe (said \"prime\") is the same face the other way. A 2 is two quarter turns — the direction doesn't matter.",
    moves: [
      { move: "R'", says: "Right face, anticlockwise: the front of the right side comes down." },
      { move: "U'", says: "Top face, anticlockwise: the front of the top goes right." },
      { move: "R2", says: "Right face, twice." },
      { move: "U2", says: "Top face, twice." },
    ],
  },
  {
    title: "Wide turns",
    note: "Two layers at once: the face and the middle layer next to it. Written lowercase, or with a w.",
    moves: [
      { move: "r", says: "The right face and the middle layer together — the same as Rw." },
      { move: "u", says: "The top face and the layer under it together." },
    ],
  },
  {
    title: "Middle layers",
    note: "The slice between two faces, turned on its own.",
    moves: [
      { move: "M", says: "The middle layer between L and R, turned the same way as L." },
      { move: "E", says: "The layer between U and D, turned the same way as D." },
      { move: "S", says: "The layer between F and B, turned the same way as F." },
    ],
  },
  {
    title: "Turning the whole cube",
    note: "x, y and z rotate the cube in your hands without turning any layer. They are free in a solve — only turns count.",
    moves: [
      { move: "x", says: "The whole cube, the way R turns: the front goes up." },
      { move: "y", says: "The whole cube, the way U turns: the front goes left." },
      { move: "z", says: "The whole cube, the way F turns." },
    ],
  },
];

const ALL = GROUPS.flatMap((g) => g.moves);

/**
 * Every move, on one cube. Pressing a move plays it, so the notation is learned
 * by watching what the letter does rather than by reading a description of it.
 */
export function NotationPlayground() {
  const [selected, setSelected] = useState<Move>(ALL[0]);
  return (
    <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
      <div className="flex flex-col gap-8">
        {GROUPS.map((group) => (
          <section key={group.title} className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <h2 className="text-xl">{group.title}</h2>
              <p className="max-w-xl text-sm leading-relaxed text-muted">{group.note}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {group.moves.map((m) => {
                const active = m.move === selected.move;
                return (
                  <button
                    key={m.move}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setSelected(m)}
                    className={`min-w-14 rounded-xl border px-4 py-2.5 font-mono text-lg font-medium transition-colors ${
                      active ? "border-foreground bg-surface-hi" : "border-border bg-surface hover:border-muted-dim"
                    }`}
                  >
                    {m.move}
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>
      <aside className="flex flex-col gap-4 rounded-3xl border border-border bg-surface p-5 lg:sticky lg:top-6" aria-live="polite">
        <p className="font-mono text-5xl font-semibold">{selected.move}</p>
        <p className="text-base leading-relaxed text-muted" data-testid="notation-says">{selected.says}</p>
        {/* The stepper starts from the position an algorithm is FOR, which for
            one move is the cube with that move undone. Holding the move first
            cancels that, so the cube starts solved and "Watch it" shows the
            move itself happening. */}
        <AlgDemo key={selected.move} alg={selected.move} hold={selected.move} label={`The move ${selected.move}`} />
        <p className="text-xs leading-relaxed text-muted-dim">
          White on top, green in front — the way every scramble and algorithm on this site is written.
        </p>
      </aside>
    </div>
  );
}
