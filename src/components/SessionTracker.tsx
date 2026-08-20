"use client";

import { useEffect } from "react";

import { startSession } from "@/lib/analytics";

/**
 * Starts a measured session, once per visit.
 *
 * Renders nothing and lives in the root layout, so every entry point counts —
 * somebody who arrives directly on `/timer` from a search result matters as
 * much as somebody who lands on the front page, and historically the first
 * group was entirely invisible.
 *
 * The session boundary is decided in `analytics.ts` by a thirty-minute gap, not
 * by this component mounting. A client-side navigation must not look like a new
 * visit, and a return three hours later must not look like the same one.
 */
export function SessionTracker() {
  useEffect(() => {
    startSession();
  }, []);

  return null;
}
