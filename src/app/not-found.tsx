import type { Metadata } from "next";
import Link from "next/link";

import { SiteHeader } from "@/components/SiteHeader";

export const metadata: Metadata = { title: "Not found" };

/**
 * The stock Next.js 404 is a white page with black text, which on a dark-first
 * app reads as the site having broken rather than the address being wrong.
 *
 * It also offers nothing. Most people arriving here mistyped something or
 * followed a stale link, and the useful response is a way onward — so this names
 * the places worth going instead of apologising.
 */
export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col">
      <SiteHeader active="play" />

      <div className="flex flex-1 items-center justify-center px-6 pb-24">
        <div className="max-w-md text-center">
          <h1 className="text-2xl font-medium tracking-tight">
            There is nothing at this address.
          </h1>
          <p className="mt-4 text-sm leading-relaxed text-muted">
            The link is either mistyped or points at something that has moved.
          </p>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/timer"
              className="rounded-lg bg-foreground px-6 py-2.5 text-sm font-medium text-background transition-opacity hover:opacity-90"
            >
              Start solving
            </Link>
            <Link
              href="/daily"
              className="rounded-lg border border-border px-6 py-2.5 text-sm text-muted transition-colors hover:border-muted-dim hover:text-foreground"
            >
              Today&apos;s daily
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
