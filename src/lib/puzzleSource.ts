"use client";

/**
 * The two ways to turn a cube in this app, behind one interface.
 *
 * Downstream code never imports cubing.js types or learns which device it is
 * attached to — it receives `(move, timestamp, solved)` and nothing else. Adding
 * a third source later (a bot replaying a trajectory, a Stackmat timer) means
 * implementing this interface, not touching the timer or the analysis.
 */

export type PuzzleSourceKind = "keyboard" | "smartcube";

/**
 * Sources report what was turned and when — nothing about whether the cube is
 * solved. That belongs to `CubeStateTracker`, which is seeded with the scramble;
 * a keyboard puzzle starts from a solved cube and has no idea what we asked the
 * player to scramble to, so its own answer would be wrong.
 */
export interface MoveHandler {
  (move: string, timestamp: number): void;
}

export interface ConnectedPuzzle {
  kind: PuzzleSourceKind;
  /** Device name for smart cubes; a fixed label for the keyboard. */
  name: string;
  disconnect(): void;
  /** Returns an unsubscribe function. */
  onMove(handler: MoveHandler): () => void;
  /** Called if the device drops the connection. Sources that cannot tell omit it. */
  onDisconnect?(handler: () => void): void;
}

export interface SmartCubeSupport {
  supported: boolean;
  /** User-facing explanation when unsupported. Never blame the user's device vaguely. */
  reason?: string;
}

/**
 * Web Bluetooth is Chromium-only. Every browser on iOS is WebKit underneath —
 * including Chrome and Firefox — so no iPhone or iPad can connect a smart cube at
 * all, regardless of which browser is installed. That is a platform limit, not a
 * missing feature, and saying so plainly is better than a button that does nothing.
 */
export function smartCubeSupport(): SmartCubeSupport {
  if (typeof navigator === "undefined") return { supported: false };

  // A property probe rather than `in`, which narrows `navigator` to `never` for
  // the rest of the function since the DOM types don't declare `bluetooth`.
  const hasBluetooth =
    (navigator as Navigator & { bluetooth?: unknown }).bluetooth !== undefined;
  if (hasBluetooth) return { supported: true };

  const ua = navigator.userAgent;
  const isIOS =
    /iPad|iPhone|iPod/.test(ua) ||
    // iPadOS reports as a Mac; the touch points give it away.
    (/Macintosh/.test(ua) && typeof document !== "undefined" && navigator.maxTouchPoints > 1);

  if (isIOS) {
    return {
      supported: false,
      reason:
        "Smart cubes need Web Bluetooth, which Apple does not allow on iPhone or iPad in any browser. Keyboard cubing works here, and smart cubes work on desktop Chrome, Edge, or Android Chrome.",
    };
  }
  if (/Safari/.test(ua) && !/Chrome|Chromium|Edg/.test(ua)) {
    return {
      supported: false,
      reason: "Safari does not support Web Bluetooth. Smart cubes work in Chrome or Edge.",
    };
  }
  return {
    supported: false,
    reason: "This browser does not support Web Bluetooth. Smart cubes work in Chrome or Edge.",
  };
}

type BluetoothModule = typeof import("cubing/bluetooth");

let modulePromise: Promise<BluetoothModule> | null = null;
function loadBluetoothModule(): Promise<BluetoothModule> {
  modulePromise ??= import("cubing/bluetooth");
  return modulePromise;
}

/** Shared wiring: both sources are `BluetoothPuzzle` subclasses underneath. */
function wrap(
  puzzle: {
    name(): string | undefined;
    disconnect(): void;
    addAlgLeafListener(
      listener: (e: { latestAlgLeaf: unknown; timeStamp: number }) => void,
    ): void;
  },
  kind: PuzzleSourceKind,
  fallbackName: string,
): ConnectedPuzzle {
  const handlers = new Set<MoveHandler>();

  puzzle.addAlgLeafListener((event) => {
    const move = String(event.latestAlgLeaf);
    // Stamped here rather than passing `event.timeStamp` through, so every source
    // shares one clock with the live display. Device-reported timestamps differ in
    // origin between keyboard events and BLE packets, and a solve timed against a
    // different clock than it is displayed on is silently wrong.
    for (const handler of handlers) handler(move, performance.now());
  });

  return {
    kind,
    name: puzzle.name() ?? fallbackName,
    disconnect: () => {
      handlers.clear();
      puzzle.disconnect();
    },
    onMove: (handler) => {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
  };
}

/**
 * Keyboard cubing. Works in every browser on every device with a keyboard, which
 * is why it — not Bluetooth — is the input everything else is built on.
 */
export async function connectKeyboard(target: Element): Promise<ConnectedPuzzle> {
  const { debugKeyboardConnect } = await loadBluetoothModule();
  const puzzle = await debugKeyboardConnect(target, "3x3x3");
  return wrap(puzzle, "keyboard", "Keyboard");
}

/**
 * Bluetooth smart cube. Opens the browser's device picker, so it must be called
 * from a user gesture or the browser will reject it.
 */
/**
 * Which kind of cube. "gan" is the protocol modern GAN cubes speak, and MoYu AI
 * and Monster Go with them; "classic" is everything cubing.js knows — GoCube,
 * Giiker, Rubik's Connected and the older GANs. They open different pickers, so
 * the person says which they have.
 */
export type SmartCubeFamily = "gan" | "classic";

export async function connectSmartCube(family: SmartCubeFamily = "classic"): Promise<ConnectedPuzzle> {
  const support = smartCubeSupport();
  if (!support.supported) {
    throw new Error(support.reason ?? "Smart cubes are not supported in this browser.");
  }
  if (family === "gan") {
    const [{ connectGanSmartCube }, { askForMac, rememberedMac }] = await Promise.all([
      import("./ganSource"),
      import("./macPrompt"),
    ]);
    return connectGanSmartCube(askForMac, rememberedMac);
  }
  const { connectSmartPuzzle } = await loadBluetoothModule();
  const puzzle = await connectSmartPuzzle({ acceptAllDevices: false });
  return wrap(puzzle, "smartcube", "Smart cube");
}
