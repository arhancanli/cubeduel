/**
 * Next 16 renamed `middleware` to `proxy`; this is the same hook under the new name.
 *
 * There is nothing here, and that is the point.
 *
 * This file used to run `clerkMiddleware()` on every matched request purely to
 * attach session state for pages that wanted to show it. Identity is now a
 * cookie the server reads where it needs it, so nothing has to happen before a
 * request reaches its route — which removes a hop from every page load,
 * including the static ones that never cared.
 *
 * Deliberately no route protection either, exactly as before. Every page works
 * signed out: you land on the timer and you are solving within a second,
 * without an account. Gating play behind a sign-up is the single most effective
 * way to kill a game's conversion, and the account only has to earn itself once
 * somebody already cares — history that follows them between devices, a rating,
 * a profile.
 *
 * Kept as a file rather than deleted so that the reasoning survives. The next
 * person to reach for middleware should find this note first.
 */
export default function proxy() {
  return undefined;
}

export const config = {
  // Matches nothing. A proxy that runs on every request to do nothing is a hop
  // paid on every page load for no return.
  matcher: [],
};
