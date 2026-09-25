/**
 * How the keyboard cube looks and moves — a player's own preference, kept in
 * this browser.
 *
 * cubing.js animates a turn over half a second. A keyboard solver types four
 * to eight turns a second, so each turn was cut off half-drawn by the next and
 * the cube read as mushy and behind the fingers. A real fast turn is about a
 * tenth of a second; that is the default now.
 */

export type TurnSpeed = "smooth" | "fast" | "instant";

export const TURN_SPEEDS: readonly { id: TurnSpeed; label: string; ms: number }[] = [
  { id: "smooth", label: "Smooth", ms: 400 },
  { id: "fast", label: "Fast", ms: 120 },
  { id: "instant", label: "Instant", ms: 10 },
];

export interface PlayView {
  speed: TurnSpeed;
  /** A second small cube showing the faces a keyboard solver cannot turn to see. */
  showBack: boolean;
}

export const DEFAULT_PLAY_VIEW: PlayView = { speed: "fast", showBack: false };

export const PLAY_VIEW_KEY = "cubeduel.playView.v1";

/** How long one turn takes to draw. */
export function turnMs(speed: TurnSpeed): number {
  return TURN_SPEEDS.find((s) => s.id === speed)?.ms ?? 120;
}

/** cubing.js draws a turn in 500ms at tempo 1; the tempo that gives `speed`. */
export function tempoFor(speed: TurnSpeed): number {
  return 500 / turnMs(speed);
}

/** A stored view, or the default for anything missing or unreadable. */
export function parsePlayView(raw: string | null): PlayView {
  if (!raw) return DEFAULT_PLAY_VIEW;
  try {
    const value = JSON.parse(raw) as Partial<PlayView>;
    return {
      speed: TURN_SPEEDS.some((s) => s.id === value.speed) ? (value.speed as TurnSpeed) : DEFAULT_PLAY_VIEW.speed,
      showBack: typeof value.showBack === "boolean" ? value.showBack : DEFAULT_PLAY_VIEW.showBack,
    };
  } catch {
    return DEFAULT_PLAY_VIEW;
  }
}
