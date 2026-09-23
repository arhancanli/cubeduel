"use client";

import { useEffect, useRef, useState } from "react";

import { mayHideOnStart } from "@/lib/reveal";

/**
 * Fades a block up as it scrolls into view, once.
 *
 * The block is sent visible. It used to be sent at opacity 0 and shown by an
 * effect, which left every heading and paragraph on the page blank until the
 * JavaScript had downloaded and run — seconds on a mid-range phone, and for
 * ever to anything that does not run scripts. Now only a block that starts
 * below the first screen is hidden, in the browser, where nobody has seen it
 * yet. Honours `prefers-reduced-motion`, and without IntersectionObserver
 * nothing is ever hidden.
 */
export function Reveal({
  children,
  delayMs = 0,
  className = "",
}: {
  children: React.ReactNode;
  delayMs?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // "static": as sent, visible. "waiting": below the fold, hidden until seen.
  // "shown": fading in.
  const [state, setState] = useState<"static" | "waiting" | "shown">("static");

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (
      typeof IntersectionObserver === "undefined" ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
      !mayHideOnStart(node.getBoundingClientRect().top, window.innerHeight)
    ) {
      return;
    }
    setState("waiting");
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setState("shown");
          observer.disconnect();
        }
      },
      { rootMargin: "-10% 0px -10% 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const motion =
    state === "waiting"
      ? "translate-y-4 opacity-0"
      : state === "shown"
        ? "transition-all duration-700 ease-out translate-y-0 opacity-100"
        : "";

  return (
    <div
      ref={ref}
      data-reveal={state}
      style={state === "shown" ? { transitionDelay: `${delayMs}ms` } : undefined}
      className={`${motion} ${className}`}
    >
      {children}
    </div>
  );
}
