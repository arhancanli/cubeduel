import { currentViewer } from "@/lib/server/viewer";
import { isDatabaseConfigured } from "@/lib/server/supabase";

/**
 * Who is signed in, for the parts of the interface that run in the browser.
 *
 * Deliberately says almost nothing. A handle and a display name are already
 * public — they are on `/u/<handle>` — and the address is here because the
 * settings menu shows it to its owner. Nothing else belongs in a response the
 * page keeps in memory.
 *
 * `no-store` because a cached "signed in" is a stale one: it would survive
 * signing out, and on a shared machine it would survive the person.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  if (!isDatabaseConfigured()) {
    return Response.json({ signedIn: false }, { headers: { "Cache-Control": "no-store" } });
  }

  const viewer = await currentViewer();

  return Response.json(
    viewer
      ? {
          signedIn: true,
          handle: viewer.handle,
          displayName: viewer.displayName,
          email: viewer.email,
          emailVerified: viewer.emailVerified,
        }
      : { signedIn: false },
    { headers: { "Cache-Control": "no-store" } },
  );
}
