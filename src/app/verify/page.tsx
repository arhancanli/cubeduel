import type { Metadata } from "next";
import Link from "next/link";

import { SiteHeader } from "@/components/SiteHeader";
import { completeEmailVerification } from "@/lib/server/emailTokens";
import { isDatabaseConfigured } from "@/lib/server/supabase";

/**
 * Confirming an address from an emailed link.
 *
 * This one *does* act on a GET, unlike the reset page, and the difference is
 * deliberate: confirming an address is not destructive, and putting a button in
 * the way turns a one-click job into two for no gain.
 *
 * What that costs is prefetching — mail clients and corporate link scanners
 * fetch every URL in a message, so the token is often spent by a machine
 * seconds before the person clicks. `completeEmailVerification` handles it: a
 * spent link whose account is now confirmed reports success, because that is
 * the truth and "invalid link" would not be.
 */
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Confirm your address · cubeduel",
  robots: { index: false, follow: false },
};

export default async function VerifyPage(props: PageProps<"/verify">) {
  const params = await props.searchParams;
  const token = typeof params.token === "string" ? params.token : null;

  const result = !isDatabaseConfigured()
    ? ({ ok: false, reason: "unknown" } as const)
    : token
      ? await completeEmailVerification(token)
      : ({ ok: false, reason: "unknown" } as const);

  const confirmed = result.ok;

  return (
    <main className="flex min-h-dvh flex-col">
      <SiteHeader active="progress" />

      <div className="mx-auto flex w-full max-w-sm flex-1 flex-col gap-6 px-6 pb-24 pt-12">
        <h1 className="text-2xl font-medium tracking-tight">
          {confirmed ? "Address confirmed" : "That link did not work"}
        </h1>

        {confirmed ? (
          <>
            <p className="text-sm leading-relaxed text-muted">
              This is what lets you back into your account if you lose your
              passkey. Nothing else changes.
            </p>
            <Link
              href="/progress"
              className="self-start rounded-lg bg-foreground px-6 py-3 text-sm font-medium text-background transition-opacity hover:opacity-90"
            >
              Back to your solves
            </Link>
          </>
        ) : (
          <>
            <p className="text-sm leading-relaxed text-muted">
              {result.reason === "expired"
                ? "Confirmation links expire after an hour."
                : "It may have been broken across two lines by your mail client, or already replaced by a newer one."}
            </p>
            <p className="text-sm leading-relaxed text-muted-dim">
              Open{" "}
              <Link href="/settings" className="text-foreground underline underline-offset-4">
                your settings
              </Link>{" "}
              to send yourself another.
            </p>
          </>
        )}
      </div>
    </main>
  );
}
