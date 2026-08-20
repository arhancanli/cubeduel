"use client";

import { useSession } from "@/lib/useSession";
import { useEffect, useRef } from "react";

import { syncLocalHistory } from "@/lib/sync";

/**
 * Uploads local history once, shortly after a signed-in page settles.
 *
 * Mounted in the root layout so it covers every route without each screen having
 * to remember. Three deliberate choices:
 *
 * - **Nothing is rendered.** Sync is not a feature anyone asked for; it is the
 *   account quietly doing what an account is for. A spinner or a toast would
 *   make a background detail into an interruption.
 * - **It runs after a delay.** The first seconds after load belong to getting a
 *   scramble on screen and the timer interactive. A sync of a year of history
 *   competing for that bandwidth is the wrong priority.
 * - **It never blocks and never reports failure.** Offline, the watermark stays
 *   put and the next visit resumes. Failing loudly would be telling someone
 *   about a problem they cannot act on.
 */
export function HistorySync() {
  const { loaded, session } = useSession();
  const done = useRef(false);

  useEffect(() => {
    if (!loaded || !session.signedIn || done.current) return;
    done.current = true;

    const timer = setTimeout(() => {
      void syncLocalHistory().catch(() => {});
    }, 2500);

    return () => clearTimeout(timer);
  }, [loaded, session.signedIn]);

  return null;
}
