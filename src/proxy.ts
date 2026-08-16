import { clerkMiddleware } from "@clerk/nextjs/server";

/**
 * Next 16 renamed `middleware` to `proxy`; this is the same hook under the new name.
 *
 * Deliberately no route protection. Every page works signed out — you can land on
 * the timer and be solving within a second, without an account. Gating play behind
 * a sign-up is the single most effective way to kill a game's conversion, and the
 * account only has to earn itself once someone already cares (history that follows
 * them between devices, a rating, a profile).
 *
 * This runs purely to attach session state for the pages that want to show it.
 */
export default clerkMiddleware();

export const config = {
  matcher: [
    // Everything except Next internals and static files, unless they carry params.
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
