import { jsonError } from "@/lib/server/authRoutes";
import { sweepAll } from "@/lib/server/maintenance";
import { isDatabaseConfigured } from "@/lib/server/supabase";

/**
 * The scheduled sweep, for Vercel Cron.
 *
 * Authorised by `CRON_SECRET`, which Vercel sends as a bearer token on every
 * cron invocation. **When the secret is unset this endpoint refuses
 * everything** — an unauthenticated delete endpoint standing open is far worse
 * than a table that grows.
 *
 * Refusing costs nothing here, and that is the important difference from the
 * last thing in this codebase that gated itself behind a secret nobody set.
 * That was an account-deletion webhook, and it was the only implementation of
 * the feature, so refusing meant the feature silently did not exist. This is an
 * automation of `npm run sweep`, which works today with no configuration at
 * all.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return jsonError(
      "CRON_SECRET is not set, so this endpoint refuses everything. Run `npm run sweep` instead.",
      503,
    );
  }

  // Constant-time is unnecessary for a value of this length that an attacker
  // cannot iterate on quickly, but the comparison is on the whole header rather
  // than a prefix, which is the mistake that actually matters here.
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return jsonError("Not authorised.", 401);
  }

  if (!isDatabaseConfigured()) return jsonError("No database configured.", 503);

  const result = await sweepAll();
  return Response.json({ ok: true, removed: result });
}
