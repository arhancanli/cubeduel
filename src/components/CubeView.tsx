"use client";

import { useEffect, useRef, useState } from "react";
import { useLatest } from "@/lib/useLatest";

/**
 * A live 3D render of the cube in its scrambled state.
 *
 * This is not decoration — it is how a cuber checks that the scramble they just
 * applied to the physical puzzle actually matches. Getting a scramble wrong and
 * only noticing halfway through a solve is the most common way a practice rep is
 * wasted.
 *
 * cubing.js ships this as a custom element backed by Three.js, so it is created
 * imperatively after a dynamic import: it must never touch the server bundle, and
 * pulling Three.js into the initial payload would delay the timer, which has to be
 * interactive immediately.
 */

type TwistyPlayerInstance = HTMLElement;

/**
 * The scramble is pushed through the DOM attribute rather than the
 * `experimentalSetupAlg` property. The property is write-only — its getter throws
 * "Cannot get `.setup` directly from a `TwistyPlayer`" — so the attribute is the
 * only representation that can be read back, which keeps the rendered state
 * inspectable in devtools and assertable from tests.
 */
const SETUP_ALG_ATTR = "experimental-setup-alg";

interface Props {
  /** Scramble to apply as the displayed state. */
  scramble: string;
  /** Whether the cube can be rotated by dragging. */
  interactive?: boolean;
  /**
   * Renders a second cube showing the three hidden faces. Verifying a scramble
   * needs all six, and a matched pair reads as deliberate where a small corner
   * inset reads as a stray fragment.
   */
  backView?: "side-by-side" | "top-right" | "none";
  /**
   * "experimental-2D-LL" is the flat last-layer diagram every OLL/PLL sheet uses.
   * It is how cubers actually recognise a case, so it is the right view for the
   * coach even though the 3D cube is better for verifying a scramble.
   */
  visualization?: "3D" | "2D" | "experimental-2D-LL";
  /**
   * Lets the cube be turned by tapping or clicking a face.
   *
   * Off by default and correctly so: on the timer the cube is a *picture of the
   * scramble* on a physical puzzle, and turning it would desync the two. On /play
   * the virtual cube IS the puzzle, and this is the only way to solve one on a
   * phone.
   */
  movePressInput?: boolean;
  /**
   * Hands the underlying player out so a caller can push live moves into it.
   * Called with null on teardown.
   */
  onPlayerReady?: (player: CubePlayer | null) => void;
  className?: string;
}

/** The slice of TwistyPlayer callers are allowed to touch. */
export type CubePlayer = HTMLElement & {
  experimentalAddMove(move: string): void;
  experimentalModel: {
    alg: { addFreshListener(listener: (alg: { toString(): string }) => void): void };
  };
};

export function CubeView({
  scramble,
  interactive = true,
  backView = "side-by-side",
  visualization = "3D",
  movePressInput = false,
  onPlayerReady,
  className = "",
}: Props) {
  // Held in a ref so a caller passing an inline function cannot force the whole
  // Three.js scene to be rebuilt on every render.
  const onReadyRef = useLatest(onPlayerReady);
  const hostRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<TwistyPlayerInstance | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  // Read at construction time so the first render shows the right state without
  // putting `scramble` in the creation effect's deps — that would rebuild the
  // whole Three.js scene on every solve.
  const scrambleRef = useLatest(scramble);

  // Created once. The scramble is pushed in through a separate effect so a new
  // scramble never costs a full Three.js teardown and rebuild.
  useEffect(() => {
    let cancelled = false;
    const host = hostRef.current;
    if (!host) return;

    (async () => {
      try {
        const { TwistyPlayer } = await import("cubing/twisty");
        if (cancelled) return;

        const player = new TwistyPlayer({
          puzzle: "3x3x3",
          visualization,
          // The page owns the background; the player must not paint its own.
          background: "none",
          controlPanel: "none",
          // A flat diagram has no back to show.
          backView: visualization === "3D" ? backView : "none",
          // `colorScheme` is deliberately not set: it paints its own grey backdrop
          // and overrides `background: "none"`. The default keeps the standard
          // sticker colours, which are not a style choice — a cuber verifies the
          // scramble against a physical puzzle, so the colours must match it.
          // Floating hint facelets are debris at this size; the second cube
          // already shows every hidden face, and shows it unambiguously.
          hintFacelets: "none",
          experimentalDragInput: interactive ? "auto" : "none",
          experimentalMovePressInput: movePressInput ? "auto" : "none",
        }) as unknown as TwistyPlayerInstance;

        if (scrambleRef.current) {
          player.setAttribute(SETUP_ALG_ATTR, scrambleRef.current);
        }
        player.style.width = "100%";
        player.style.height = "100%";
        player.style.maxWidth = "100%";

        host.replaceChildren(player);
        playerRef.current = player;
        setReady(true);
        onReadyRef.current?.(player as CubePlayer);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();

    // Captured now rather than read in the cleanup: by the time cleanup runs the
    // ref may already hold the NEXT consumer's callback, and this teardown is
    // meant to tell the consumer that owned this player that it is gone.
    const notifyOwner = onReadyRef.current;

    return () => {
      cancelled = true;
      playerRef.current = null;
      notifyOwner?.(null);
      host.replaceChildren();
    };
  }, [interactive, backView, visualization, movePressInput, onReadyRef, scrambleRef]);

  useEffect(() => {
    if (playerRef.current && scramble) {
      playerRef.current.setAttribute(SETUP_ALG_ATTR, scramble);
    }
  }, [scramble]);

  if (failed) return null;

  return (
    <div
      ref={hostRef}
      data-cube-view=""
      aria-hidden="true"
      className={`transition-opacity duration-300 ${ready ? "opacity-100" : "opacity-0"} ${className}`}
    />
  );
}
