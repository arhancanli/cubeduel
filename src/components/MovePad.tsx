"use client";

/**
 * On-screen turns, for solving without a keyboard.
 *
 * `/play` was a dead end on a phone: an armed timer, a cube that could not be
 * turned, and 400px of keyboard legend telling the user to press keys they do not
 * have. Shared links get opened on phones, so that was the first thing a large
 * share of visitors ever saw.
 *
 * Buttons rather than gestures on the 3D cube. cubing.js does support turning by
 * dragging a face, and it stays enabled — but a swipe is ambiguous (which layer,
 * which direction) in a way a labelled button is not, and on a small cube it is
 * fiddly. This is the path that always works.
 */

const FACES = [
  { face: "U", name: "Up" },
  { face: "L", name: "Left" },
  { face: "F", name: "Front" },
  { face: "R", name: "Right" },
  { face: "B", name: "Back" },
  { face: "D", name: "Down" },
] as const;

export function MovePad({
  onMove,
  className = "",
}: {
  onMove: (move: string) => void;
  className?: string;
}) {
  return (
    <div className={`grid w-full max-w-sm grid-cols-3 gap-2 ${className}`}>
      {FACES.map(({ face, name }) => (
        <div key={face} className="flex overflow-hidden rounded-md border border-border">
          {/* Clockwise on the left, anticlockwise on the right — the same order as
              the notation itself, so the prime is always the right-hand key. */}
          <button
            type="button"
            aria-label={`${name} clockwise`}
            onClick={(event) => {
              event.currentTarget.blur();
              onMove(face);
            }}
            className="flex-1 py-3 font-mono text-sm text-foreground transition-colors active:bg-surface-hi"
          >
            {face}
          </button>
          <span className="w-px self-stretch bg-border" aria-hidden="true" />
          <button
            type="button"
            aria-label={`${name} anticlockwise`}
            onClick={(event) => {
              event.currentTarget.blur();
              onMove(`${face}'`);
            }}
            className="flex-1 py-3 font-mono text-sm text-muted transition-colors active:bg-surface-hi"
          >
            {face}&apos;
          </button>
        </div>
      ))}
    </div>
  );
}
