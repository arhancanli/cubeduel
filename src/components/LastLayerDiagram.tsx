"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The flat last-layer diagram every OLL and PLL sheet in the world uses.
 *
 * Drawn by the puzzle engine rather than by hand. The geometry of which sticker
 * ends up on which face for a given orientation is easy to get subtly wrong from
 * memory, and a case diagram that is subtly wrong is the worst artefact this
 * project could ship: a learner drills it, builds recognition on it, and only
 * finds out at a competition. So the engine that already knows the puzzle draws
 * it, and this component only decides when.
 *
 * ## Mounted only when it can be seen
 *
 * A page showing all 57 OLL cases would otherwise build 57 players before
 * anything appeared. Each one is mounted as it scrolls into view and never torn
 * down again — a diagram that vanished on scroll-back would flicker every time
 * somebody compared two cases, which is the entire activity this page exists for.
 */

const ROOT_MARGIN = "300px";

export function LastLayerDiagram({
  setup,
  label,
  className = "",
}: {
  /** Moves that put a solved cube into the case. */
  setup: string;
  label: string;
  className?: string;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || visible) return;

    // No IntersectionObserver means an older browser, not a reason to show
    // nothing — mount everything and let it be slow rather than blank.
    //
    // Deferred by a tick rather than set straight away: a state change made
    // synchronously inside an effect renders twice, once with the old value.
    if (typeof IntersectionObserver === "undefined") {
      const id = setTimeout(() => setVisible(true), 0);
      return () => clearTimeout(id);
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: ROOT_MARGIN },
    );
    observer.observe(host);
    return () => observer.disconnect();
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    const host = hostRef.current;
    if (!host) return;

    (async () => {
      try {
        const { TwistyPlayer } = await import("cubing/twisty");
        if (cancelled) return;

        const player = new TwistyPlayer({
          puzzle: "3x3x3",
          visualization: "experimental-2D-LL",
          background: "none",
          controlPanel: "none",
          backView: "none",
          hintFacelets: "none",
          experimentalDragInput: "none",
        }) as unknown as HTMLElement;

        player.setAttribute("experimental-setup-alg", setup);
        player.style.width = "100%";
        player.style.height = "100%";
        host.replaceChildren(player);
        if (!cancelled) setReady(true);
      } catch {
        // A diagram that fails to draw leaves the case's name and algorithm,
        // which is still a usable card.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [visible, setup]);

  return (
    <div
      ref={hostRef}
      role="img"
      aria-label={`${label} last layer`}
      className={`aspect-square transition-opacity duration-300 ${
        ready ? "opacity-100" : "opacity-0"
      } ${className}`}
    />
  );
}
