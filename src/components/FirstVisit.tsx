"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

const KEY = "cubeduel:welcomed";

/**
 * The first time somebody lands on the timer with nothing solved yet: which of
 * the three ways to solve is theirs, and the door for somebody who can't solve
 * a cube at all. Shown once — dismissing it, or finishing a solve, retires it.
 *
 * A card in the page rather than a pop-up: it can be read and ignored, and it
 * never stands between somebody who knows what they are doing and the clock.
 */
export function FirstVisit({ hasSolves }: { hasSolves: boolean }) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        if (!hasSolves && window.localStorage.getItem(KEY) === null) setShow(true);
      } catch {
        /* storage blocked: skip the welcome rather than show it every time */
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [hasSolves]);

  if (!show || hasSolves) return null;

  const dismiss = () => {
    try {
      window.localStorage.setItem(KEY, "1");
    } catch {
      /* ignore */
    }
    setShow(false);
  };

  // One slim row: the clock is what this page is for, and a welcome that pushes
  // it off the first screen is in the way of everybody it is not for.
  const links = [
    { href: "/play", label: "No cube? Keyboard" },
    { href: "/cube", label: "Smart cube" },
    { href: "/solve", label: "Can't solve yet? Start here" },
  ];
  return (
    <section
      aria-label="First time here"
      data-testid="first-visit"
      className="flex w-full flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-sticker-green/40 bg-surface px-4 py-3"
    >
      <p className="text-sm">
        <span className="font-semibold text-sticker-green">First time?</span>{" "}
        <span className="text-muted">This is the timer for a cube in your hands.</span>
      </p>
      <span className="flex flex-1 flex-wrap gap-2">
        {links.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            onClick={dismiss}
            className="rounded-lg bg-surface-hi px-3 py-1.5 text-sm font-semibold transition-colors hover:text-sticker-green"
          >
            {link.label} →
          </Link>
        ))}
      </span>
      <button type="button" onClick={dismiss} className="text-sm font-semibold text-muted hover:text-foreground">
        Got it
      </button>
    </section>
  );
}
