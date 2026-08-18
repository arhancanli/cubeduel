import { verifySvixSignature } from "@/lib/webhookSignature";
import { deleteProfileFor } from "@/lib/server/profileStore";
import { isDatabaseConfigured } from "@/lib/server/supabase";

/**
 * Clerk telling us an account is gone.
 *
 * Without this, deleting your account leaves the profile behind — and with it a
 * public page at `/u/<handle>`, a leaderboard entry, and a rating. Somebody who
 * deletes their account has asked for it to be gone, and a site that keeps their
 * name up afterwards has not honoured that.
 *
 * The endpoint is authenticated by signature and nothing else. It has to be:
 * Clerk is not signed in as anybody, so there is no session to check, and the
 * request arrives from an address we do not control. That makes the signature
 * the only thing standing between this route and an anonymous delete-anything
 * button — which is why `verifySvixSignature` compares in constant time,
 * verifies against the raw body, and refuses anything outside a five minute
 * window.
 *
 * Configure `CLERK_WEBHOOK_SECRET` and point a Clerk webhook for `user.deleted`
 * at `/api/webhooks/clerk`. Without the secret the route refuses everything,
 * which is the correct default: a missing environment variable must never leave
 * an unauthenticated delete endpoint standing open.
 */

export const dynamic = "force-dynamic";

interface ClerkEvent {
  type?: string;
  data?: { id?: string };
}

export async function POST(request: Request) {
  const secret = process.env.CLERK_WEBHOOK_SECRET;
  if (!secret) {
    // Deliberately not "not configured" — a caller who is not Clerk learns
    // nothing about why, and a caller who is Clerk will show up in the logs.
    return new Response("Unauthorized", { status: 401 });
  }

  // The raw text, never a re-serialised object: the signature covers the exact
  // bytes that were sent, and JSON.stringify of a parsed body is not those bytes.
  const body = await request.text();

  const verdict = verifySvixSignature(
    body,
    {
      id: request.headers.get("svix-id"),
      timestamp: request.headers.get("svix-timestamp"),
      signature: request.headers.get("svix-signature"),
    },
    secret,
    Date.now(),
  );

  if (!verdict.ok) return new Response("Unauthorized", { status: 401 });

  let event: ClerkEvent;
  try {
    event = JSON.parse(body) as ClerkEvent;
  } catch {
    return new Response("Bad Request", { status: 400 });
  }

  // Everything else Clerk sends is acknowledged and ignored. Returning an error
  // for an event we simply do not act on would make Clerk retry it forever.
  if (event.type !== "user.deleted") return new Response("OK", { status: 200 });

  const userId = event.data?.id;
  if (!userId) return new Response("Bad Request", { status: 400 });

  if (!isDatabaseConfigured()) return new Response("OK", { status: 200 });

  await deleteProfileFor(userId);

  return new Response("OK", { status: 200 });
}
