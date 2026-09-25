import type { ConnectedPuzzle, MoveHandler } from "./puzzleSource";

/**
 * Modern smart cubes — GAN 12 ui, 356i Carry 2, 14 ui, Monster Go AI, MoYu AI —
 * through gan-web-bluetooth (MIT), the library csTimer's support is built on.
 * cubing.js, which handles the older cubes, does not speak their protocols.
 *
 * Only the turns matter here: each becomes a move on the page's own clock,
 * exactly as the older cubes and the keyboard do, so the timer and the review
 * cannot tell which kind of cube it was.
 */

/** The part of a GAN connection this relies on. */
export interface GanConnectionLike {
  deviceName: string;
  events$: { subscribe(next: (event: { type: string; move?: string }) => void): { unsubscribe(): void } };
  disconnect(): Promise<void> | void;
}

export function ganPuzzle(connection: GanConnectionLike, now: () => number = () => performance.now()): ConnectedPuzzle {
  const moveHandlers = new Set<MoveHandler>();
  const lostHandlers = new Set<() => void>();
  let open = true;

  // Assigned once subscribe returns. A stream can emit during subscribe — a
  // disconnect replayed at once — before there is a handle to close, and
  // reaching for it then used to throw instead of reporting the lost cube.
  let subscription: { unsubscribe(): void } | null = null;
  subscription = connection.events$.subscribe((event) => {
    if (!open) return;
    if (event.type === "MOVE" && event.move) {
      // Stamped here, not with the cube's own clock, so every source shares
      // one clock with the display (see puzzleSource.ts).
      const at = now();
      for (const handler of moveHandlers) handler(event.move, at);
    } else if (event.type === "DISCONNECT") {
      open = false;
      subscription?.unsubscribe();
      for (const handler of lostHandlers) handler();
    }
  });
  if (!open) subscription.unsubscribe();

  return {
    kind: "smartcube",
    name: connection.deviceName || "GAN cube",
    disconnect: () => {
      open = false;
      subscription?.unsubscribe();
      moveHandlers.clear();
      void connection.disconnect();
    },
    onMove: (handler) => {
      moveHandlers.add(handler);
      return () => moveHandlers.delete(handler);
    },
    onDisconnect: (handler) => {
      lostHandlers.add(handler);
    },
  };
}

/**
 * Opens the browser's picker for GAN-protocol cubes and connects. `askMac` is
 * called only when Chrome will not reveal the cube's address; it resolves to
 * the address the person typed, or null if they gave up.
 */
export async function connectGanSmartCube(
  askMac: (deviceName: string) => Promise<string | null>,
  remembered: (deviceName: string) => string | null,
): Promise<ConnectedPuzzle> {
  const { connectGanCube } = await import("gan-web-bluetooth");
  const connection = await connectGanCube(async (device, isFallbackCall) => {
    const name = device.name ?? "";
    // First try: an address this cube has given before. Otherwise let the
    // library read it itself, and ask the person only as the last resort.
    if (!isFallbackCall) return remembered(name);
    return askMac(name);
  });
  return ganPuzzle(connection as unknown as GanConnectionLike);
}
