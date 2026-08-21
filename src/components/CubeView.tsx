"use client";

import { useEffect, useRef, useState } from "react";
import { applyAppearance } from "@/lib/applyCubeAppearance";
import {
  APPEARANCE_CHANGED,
  DEFAULT_APPEARANCE_ID,
  loadAppearanceId,
} from "@/lib/cubeAppearance";
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

  /**
   * The chosen appearance, as state rather than as a read inside the effect, so
   * that changing it rebuilds the player.
   *
   * Rebuilding is heavier than repainting and it is the honest choice.
   * TwistyPlayer draws on demand and exposes no way to ask for a frame —
   * `experimentalCurrentThreeJSPuzzleObject` takes a callback that *reports*
   * a scheduled render rather than causing one, and the whole player has
   * exactly two render-related members. Materials changed after the first frame
   * update the scene and are simply never drawn: measured, not assumed, by
   * repainting 134 materials magenta and watching a screenshot hash stay
   * byte-identical until the viewport was resized.
   *
   * Every trick tried to force a frame — a synthetic resize event, a fractional
   * element resize, nudging the camera, re-setting the setup attribute — failed.
   * So rather than ship a cosmetic feature resting on an undocumented poke that
   * silently stops working, the cube is rebuilt. It costs a Three.js teardown on
   * an action somebody takes once, in settings, deliberately.
   */
  const [appearanceId, setAppearanceId] = useState(DEFAULT_APPEARANCE_ID);

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
          // `colorScheme` is deliberately not set. Despite the name it is a
          // light/dark theme for the surrounding UI, not the puzzle — it paints
          // its own grey backdrop and overrides `background: "none"`. cubing.js
          // offers no sticker-colour option at all, which is why the appearance
          // is applied to the Three.js materials below instead.
          //
          // The colours remain a functional matter rather than a style one: a
          // cuber verifies the scramble against a physical puzzle, so what is
          // on screen has to match what is in their hands. That is exactly why
          // the Japanese scheme is offered, and why the default is the real
          // Rubik's pigments rather than cubing.js's web primaries.
          //
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

        // Painted before the cube is revealed. The host starts at opacity 0 and
        // fades in when `ready` flips, so doing this first means nobody ever
        // sees the default palette flash to the chosen one.
        await applyAppearance(player, appearanceId);
        if (cancelled) return;

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
  }, [interactive, backView, visualization, movePressInput, appearanceId, onReadyRef, scrambleRef]);

  useEffect(() => {
    if (playerRef.current && scramble) {
      playerRef.current.setAttribute(SETUP_ALG_ATTR, scramble);
    }
  }, [scramble]);

  /**
   * Follow the preference.
   *
   * Both events, and they are not redundant: `storage` fires only in OTHER
   * tabs, so on its own the cube sitting next to the picker that just changed
   * it would be the single cube in the browser that did not update. The custom
   * event covers this tab; `storage` covers the rest.
   *
   * Reading it here rather than in the creation effect keeps the first render
   * server-safe — `localStorage` does not exist during it, and reading it in a
   * render body would make the two passes disagree.
   */
  useEffect(() => {
    const follow = () => setAppearanceId(loadAppearanceId());
    follow();
    window.addEventListener(APPEARANCE_CHANGED, follow);
    window.addEventListener("storage", follow);
    return () => {
      window.removeEventListener(APPEARANCE_CHANGED, follow);
      window.removeEventListener("storage", follow);
    };
  }, []);

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
