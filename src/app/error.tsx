"use client";

import Link from "next/link";
import { useEffect } from "react";

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

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 px-6 text-center">
      <div className="flex max-w-md flex-col gap-3">
        <h1 className="text-2xl font-medium tracking-tight">Something broke.</h1>
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
          className="rounded-lg bg-foreground px-5 py-2.5 text-sm font-medium text-background transition-opacity hover:opacity-90"
        >
          Try again
        </button>
        <Link
          href="/timer"
          className="rounded-lg border border-border px-5 py-2.5 text-sm text-muted transition-colors hover:border-muted-dim hover:text-foreground"
        >
          Back to the timer
        </Link>
        <button
          type="button"
          onClick={() => {
            try {
              window.localStorage.clear();
            } catch {
              /* Nothing more we can do; the reload is still worth attempting. */
            }
            window.location.href = "/timer";
          }}
          className="rounded-lg border border-danger/40 px-5 py-2.5 text-sm text-danger transition-colors hover:bg-danger/10"
        >
          Clear stored data
        </button>
      </div>
    </main>
  );
}
