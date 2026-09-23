"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { Mark } from "@/components/Glyph";

/**
 * Last line of defence.
 *
 * Without this, an unhandled render error left a blank page with no way out — and
 * because the cause is usually stored data, reloading re-read it and crashed again.
 * The escape hatch has to be here, above whatever failed, or it can never render.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("cubeduel crashed:", error);
  }, [error]);
  // Clearing storage deletes every solve on this device, so it takes two
  // presses: the first says what it will do, the second does it.
  const [confirming, setConfirming] = useState(false);

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 px-6 text-center">
      <div className="flex max-w-md flex-col items-center gap-3">
        <Mark size={40} />
        <h1 className="text-3xl">Something broke.</h1>
        <p className="text-sm leading-relaxed text-muted">
          Your solves are stored on this device and are almost certainly fine. If this
          page keeps failing, the stored data is the likely cause and clearing it will
          fix it — at the cost of your history.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={reset}
          className="btn-go px-5 py-2.5 text-sm"
        >
          Try again
        </button>
        <Link
          href="/timer"
          className="btn-secondary px-5 py-2.5 text-sm"
        >
          Back to the timer
        </Link>
        {!confirming ? (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="rounded-lg border border-danger/40 px-5 py-2.5 text-sm text-danger transition-colors hover:bg-danger/10"
          >
            Clear stored data…
          </button>
        ) : (
        <button
          type="button"
          onClick={() => {
            try {
              window.localStorage.clear();
            } catch {
              /* Nothing more we can do; the reload is still worth attempting. */
            }
            // A full document load, deliberately, and not `router.push()`.
            //
            // This button exists because a corrupt record took the page down
            // during render, so the React tree that would handle a soft
            // navigation is the broken thing we are escaping. Reloading is the
            // point: it re-reads storage from scratch with the bad record gone.
            // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- see above
            window.location.href = "/timer";
          }}
          className="rounded-lg bg-danger px-5 py-2.5 text-sm font-semibold text-background"
        >
          Yes — delete every solve on this device
        </button>
        )}
      </div>
    </main>
  );
}
