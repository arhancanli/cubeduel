"use client";

import { friendlyBluetoothError } from "./bluetoothErrors";
import type { ConnectedPuzzle } from "./puzzleSource";

/**
 * What the app knows about the cube in somebody's hands.
 *
 * ## The problem nobody warns you about
 *
 * A Bluetooth cube reports *moves*, not state. It says "R was turned", never
 * "here is the cube". So the app has to assume a starting position, and the
 * assumption every implementation reaches for is "solved".
 *
 * That assumption is wrong most of the time. People pick up the cube they were
 * last using, which is scrambled. Connect then, and every screen quietly lies:
 * the virtual cube shows a solved puzzle turning, solve detection never fires
 * because the tracker thinks it is one move from home, and the case you are
 * drilling is not the case in your hands. Nothing errors. It simply produces
 * confident nonsense, which is the worst failure this project can have.
 *
 * So a link is not usable until it has been *calibrated*: the person says, once,
 * that the cube in their hands matches the cube on the screen. Until they do,
 * this reports `needs-calibration` and callers must not treat moves as truth.
 *
 * The alternative — asking the cube for its state — only works on hardware that
 * offers it, and cubing.js's shared interface does not. Pretending otherwise
 * would mean the feature works on one brand and silently misleads on the rest.
 */

export type LinkStatus =
  | "idle"
  | "connecting"
  /** Connected, but the app does not yet know what the cube looks like. */
  | "needs-calibration"
  | "live"
  | "lost";

export interface LinkState {
  status: LinkStatus;
  /** Device name, once connected. */
  name: string | null;
  /** Why the last attempt failed, in words a person can act on. */
  error: string | null;
  /** Moves seen since calibration. */
  moveCount: number;
}

export const IDLE: LinkState = {
  status: "idle",
  name: null,
  error: null,
  moveCount: 0,
};

export function connecting(previous: LinkState): LinkState {
  return { ...previous, status: "connecting", error: null };
}

export function connected(name: string): LinkState {
  return { status: "needs-calibration", name, error: null, moveCount: 0 };
}

/**
 * The person has confirmed the cube in their hands is solved.
 *
 * This is the only way into `live`, and it resets the move count — everything
 * before this point was turned against a state the app was guessing at.
 */
export function calibrated(previous: LinkState): LinkState {
  if (previous.status !== "needs-calibration" && previous.status !== "live") {
    return previous;
  }
  return { ...previous, status: "live", error: null, moveCount: 0 };
}

export function moved(previous: LinkState): LinkState {
  if (previous.status !== "live") return previous;
  return { ...previous, moveCount: previous.moveCount + 1 };
}

/**
 * The cube went away — out of range, asleep, or switched off.
 *
 * Kept as a distinct state rather than dropping back to `idle`, because those
 * mean different things to the person holding it: one is "you have not connected
 * yet" and the other is "the thing you were using stopped". Telling them apart
 * is the difference between a helpful message and a mystery.
 */
export function lost(previous: LinkState): LinkState {
  return {
    ...previous,
    status: "lost",
    error: "The cube disconnected. It may have gone to sleep, or moved out of range.",
  };
}

export function failed(previous: LinkState, error: unknown): LinkState {
  const message =
    error instanceof Error && error.message
      ? error.message
      : "Could not connect to that cube.";

  // The browser's own "user cancelled the picker" is not a failure and must not
  // be shown as one — somebody who changed their mind has not hit an error.
  const cancelled = /cancel|user gesture|chooser/i.test(message);
  return {
    ...previous,
    status: previous.name ? "needs-calibration" : "idle",
    error: cancelled ? null : friendlyBluetoothError(message),
  };
}

/** Whether moves from this link may be trusted as describing a real cube. */
export function isTrustworthy(state: LinkState): boolean {
  return state.status === "live";
}

/** One line describing where things stand, for the person holding the cube. */
export function describe(state: LinkState): string {
  switch (state.status) {
    case "idle":
      return "No cube connected.";
    case "connecting":
      return "Looking for your cube…";
    case "needs-calibration":
      return "Connected. Solve your cube, then say so — until then this cannot know what you are holding.";
    case "live":
      return state.moveCount === 0
        ? "Live. Turn your cube."
        : `Live. ${state.moveCount} ${state.moveCount === 1 ? "turn" : "turns"} so far.`;
    case "lost":
      return "Disconnected.";
  }
}

/**
 * A cube that is not there, for tests and for showing the flow without hardware.
 *
 * Every path below the `ConnectedPuzzle` interface — calibration, mirroring,
 * solve detection, disconnection — is the same code whether the moves come from
 * a GAN over Bluetooth or from here. That is the point of the interface, and it
 * is the only way this feature can be tested at all: there is no smart cube in
 * continuous integration.
 *
 * It is not a substitute for testing against real hardware, and the README says
 * so. What it does test is everything that is not the radio.
 */
export function simulatedCube(name = "Simulated cube"): ConnectedPuzzle & {
  turn(move: string): void;
  drop(): void;
} {
  const handlers = new Set<(move: string, timestamp: number) => void>();
  let dropped = false;

  return {
    kind: "smartcube",
    name,
    disconnect() {
      handlers.clear();
      dropped = true;
    },
    onMove(handler) {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    turn(move: string) {
      if (dropped) return;
      for (const handler of handlers) handler(move, performance.now());
    },
    drop() {
      dropped = true;
      handlers.clear();
    },
  };
}
