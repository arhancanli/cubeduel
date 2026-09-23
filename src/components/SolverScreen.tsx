"use client";

import { useMemo, useState } from "react";

import { AlgDemo } from "@/components/AlgDemo";
import { SOLVED_FACELETS, cubeToFacelets } from "@/lib/solver/facelets";
import { cubeFromAlg } from "@/lib/solver/cube";

/**
 * The solver: paint the cube in your hands onto a net, get it solved.
 *
 * Kept deliberately plain to use. Six colours to pick from, a net of 54
 * stickers where the centres are fixed (they define the colour scheme and
 * never move), and one button. Everything a person can get wrong while typing
 * in a cube by hand — a colour used ten times, a corner that cannot exist — is
 * caught and explained in words before anything is sent anywhere.
 */

type Face = "U" | "R" | "F" | "D" | "L" | "B";
type Sticker = Face | null;

const FACE_ORDER: Face[] = ["U", "R", "F", "D", "L", "B"];

const COLOURS: { face: Face; name: string; value: string }[] = [
  { face: "U", name: "White", value: "var(--sticker-white)" },
  { face: "F", name: "Green", value: "var(--sticker-green)" },
  { face: "R", name: "Red", value: "var(--sticker-red)" },
  { face: "B", name: "Blue", value: "var(--sticker-blue)" },
  { face: "L", name: "Orange", value: "var(--sticker-orange)" },
  { face: "D", name: "Yellow", value: "var(--sticker-yellow)" },
];
const COLOUR_OF = Object.fromEntries(COLOURS.map((c) => [c.face, c])) as Record<Face, (typeof COLOURS)[number]>;

const FACE_NAME: Record<Face, string> = { U: "Top", R: "Right", F: "Front", D: "Bottom", L: "Left", B: "Back" };

/** Where each face sits in the net, as a column and row of 3×3 blocks. */
const NET: Record<Face, [number, number]> = { U: [1, 0], L: [0, 1], F: [1, 1], R: [2, 1], B: [3, 1], D: [1, 2] };

const isCentre = (i: number) => i % 9 === 4;

function blank(): Sticker[] {
  return Array.from({ length: 54 }, (_, i) => (isCentre(i) ? FACE_ORDER[Math.floor(i / 9)] : null));
}

function fromFacelets(s: string): Sticker[] {
  return s.split("") as Face[];
}

interface Answer {
  solution: string[];
  optimalMoves: number;
  computeMs: number;
}

export function SolverScreen() {
  const [stickers, setStickers] = useState<Sticker[]>(blank);
  const [brush, setBrush] = useState<Face>("U");
  const [scramble, setScramble] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [answer, setAnswer] = useState<Answer | null>(null);

  const counts = useMemo(() => {
    const c: Record<Face, number> = { U: 0, R: 0, F: 0, D: 0, L: 0, B: 0 };
    for (const s of stickers) if (s) c[s] += 1;
    return c;
  }, [stickers]);
  const filled = stickers.every(Boolean);

  const paint = (i: number) => {
    if (isCentre(i)) return;
    setAnswer(null);
    setError(null);
    setStickers((prev) => prev.map((s, j) => (j === i ? brush : s)));
  };

  const fillFromScramble = () => {
    const alg = scramble.trim();
    if (!alg) return;
    try {
      if (!/^([URFDLB]['2]?\s*)+$/.test(alg)) throw new Error("bad");
      setStickers(fromFacelets(cubeToFacelets(cubeFromAlg(alg))));
      setAnswer(null);
      setError(null);
    } catch {
      setError("That scramble uses moves this page doesn't read. Use face turns like R U' F2.");
    }
  };

  const solveIt = async () => {
    if (!filled) {
      setError("Fill in every sticker first. The grey ones are still empty.");
      return;
    }
    setBusy(true);
    setError(null);
    setAnswer(null);
    try {
      const response = await fetch("/api/solve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ facelets: stickers.join("") }),
      });
      const body = (await response.json()) as Partial<Answer> & { error?: string };
      if (!response.ok || !body.solution) {
        setError(body.error ?? "Something went wrong reaching the solver. Try again.");
      } else {
        setAnswer({ solution: body.solution, optimalMoves: body.optimalMoves ?? body.solution.length, computeMs: body.computeMs ?? 0 });
      }
    } catch {
      setError("Couldn't reach the solver. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
      <section aria-labelledby="enter-heading" className="flex flex-col gap-5 rounded-3xl border border-border bg-surface p-5 sm:p-7">
        <div className="flex flex-col gap-1">
          <h2 id="enter-heading" className="text-2xl">1. Enter your cube</h2>
          <p className="text-sm leading-relaxed text-muted">
            Hold it with <b className="text-foreground">white on top</b> and <b className="text-foreground">green facing you</b>.
            Pick a colour, then tap the stickers. The centres are fixed.
          </p>
        </div>

        <div role="radiogroup" aria-label="Colour" className="flex flex-wrap gap-2">
          {COLOURS.map((c) => {
            const selected = brush === c.face;
            return (
              <button
                key={c.face}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setBrush(c.face)}
                className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold transition-colors ${
                  selected ? "border-foreground bg-surface-hi" : "border-border hover:border-muted-dim"
                }`}
              >
                <span aria-hidden="true" className="size-5 rounded-md border border-black/30" style={{ background: c.value }} />
                {c.name}
                <span className={`tnum text-xs ${counts[c.face] === 9 ? "text-ready" : counts[c.face] > 9 ? "text-danger" : "text-muted-dim"}`}>
                  {counts[c.face]}/9
                </span>
              </button>
            );
          })}
        </div>

        {/* The net: 12 × 9 cells, faces in their usual places. */}
        <div className="overflow-x-auto">
          <div
            className="mx-auto grid w-full min-w-[19rem] max-w-[34rem] gap-[3px]"
            style={{ gridTemplateColumns: "repeat(12, minmax(0, 1fr))" }}
            data-testid="solver-net"
          >
            {FACE_ORDER.flatMap((face, f) => {
              const [col, row] = NET[face];
              return Array.from({ length: 9 }, (_, k) => {
                const i = f * 9 + k;
                const s = stickers[i];
                const r = Math.floor(k / 3);
                const c = k % 3;
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => paint(i)}
                    disabled={isCentre(i)}
                    aria-label={`${FACE_NAME[face]} face, row ${r + 1}, column ${c + 1}: ${s ? COLOUR_OF[s].name.toLowerCase() : "empty"}`}
                    style={{
                      gridColumn: col * 3 + c + 1,
                      gridRow: row * 3 + r + 1,
                      background: s ? COLOUR_OF[s].value : undefined,
                    }}
                    className={`aspect-square rounded-[5px] border ${
                      s ? "border-black/35" : "border-dashed border-border bg-surface-hi"
                    } ${isCentre(i) ? "cursor-default ring-1 ring-inset ring-black/30" : "transition-transform hover:scale-[1.06]"}`}
                  />
                );
              });
            })}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => { setStickers(blank()); setAnswer(null); setError(null); }} className="btn-secondary px-4 py-2 text-sm">
            Clear
          </button>
          <button type="button" onClick={() => { setStickers(fromFacelets(SOLVED_FACELETS)); setAnswer(null); setError(null); }} className="btn-secondary px-4 py-2 text-sm">
            Start from solved
          </button>
        </div>

        <details className="rounded-xl border border-border px-4 py-3">
          <summary className="cursor-pointer text-sm font-semibold">Have a scramble instead?</summary>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              fillFromScramble();
            }}
            className="mt-3 flex flex-wrap gap-2"
          >
            <label htmlFor="scramble-input" className="sr-only">Scramble</label>
            <input
              id="scramble-input"
              value={scramble}
              onChange={(e) => setScramble(e.target.value)}
              placeholder="R U R' F2 D …"
              className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm"
            />
            <button type="submit" className="btn-secondary px-4 py-2 text-sm">
              Fill the net
            </button>
          </form>
        </details>
      </section>

      <section aria-labelledby="solve-heading" className="flex flex-col gap-5 rounded-3xl border border-border bg-surface p-5 sm:p-7 lg:sticky lg:top-6">
        <div className="flex flex-col gap-1">
          <h2 id="solve-heading" className="text-2xl">2. Solve it</h2>
          <p className="text-sm leading-relaxed text-muted">
            {filled
              ? "Every sticker is filled. The solver checks the cube is real before it solves it."
              : `${stickers.filter((s) => !s).length} stickers left to fill.`}
          </p>
        </div>

        <button type="button" onClick={() => void solveIt()} disabled={busy} className="btn-go justify-center py-3.5 text-base" data-testid="solver-solve">
          {busy ? "Solving…" : "Solve my cube"}
        </button>

        {error ? (
          <p role="alert" className="rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-sm leading-relaxed text-danger" data-testid="solver-error">
            {error}
          </p>
        ) : null}

        {answer ? (
          <div className="flex flex-col gap-4" data-testid="solver-answer">
            <p className="flex items-baseline gap-3">
              <span className="tnum font-display text-5xl font-extrabold">{answer.optimalMoves}</span>
              <span className="text-muted">
                moves{answer.optimalMoves === 0 ? " — it's already solved" : ""}
              </span>
            </p>
            {answer.solution.length > 0 ? (
              <>
                <p className="flex flex-wrap gap-1.5 font-mono text-lg" data-testid="solver-moves">
                  {answer.solution.map((m, i) => (
                    <span key={`${m}-${i}`} className="rounded-md bg-surface-hi px-2 py-0.5">{m}</span>
                  ))}
                </p>
                <p className="text-xs text-muted-dim">
                  Found in {answer.computeMs} ms. Hold the cube the same way — white on top, green in front —
                  and turn each face as written: R is the right face clockwise, R&apos; anticlockwise, R2 twice.
                </p>
                <AlgDemo alg={answer.solution.join(" ")} label="Your solution" />
              </>
            ) : null}
          </div>
        ) : null}
      </section>
    </div>
  );
}
