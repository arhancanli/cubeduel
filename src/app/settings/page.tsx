import type { Metadata } from "next";
import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { SiteHeader } from "@/components/SiteHeader";
import { handleRejectionReason } from "@/lib/handle";
import { ensureProfile, updateHandle } from "@/lib/server/profiles";
import { isDatabaseConfigured } from "@/lib/server/supabase";

export const metadata: Metadata = { title: "Settings — cubeduel" };
export const dynamic = "force-dynamic";

/**
 * Where a player fixes the handle they were given.
 *
 * New accounts are seeded with a handle derived from whatever Clerk knows,
 * because stopping someone at a naming form before they have seen the product is
 * the reliable way to lose them. The cost of that choice is that the name they
 * end up with may not be one they chose — so changing it has to be easy, obvious,
 * and reachable from the account menu rather than buried.
 */
export default async function SettingsPage(props: PageProps<"/settings">) {
  if (!isDatabaseConfigured()) {
    return (
      <Shell>
        <p className="text-sm text-muted">Accounts are not configured for this deployment.</p>
      </Shell>
    );
  }

  const profile = await ensureProfile();
  if (!profile) {
    return (
      <Shell>
        <p className="text-sm text-muted">Sign in to change your handle.</p>
      </Shell>
    );
  }

  const params = await props.searchParams;
  const error = typeof params.error === "string" ? params.error : null;
  const saved = params.saved === "1";

  async function save(formData: FormData) {
    "use server";

    const current = await ensureProfile();
    if (!current) redirect("/settings?error=Sign+in+first.");

    const requested = String(formData.get("handle") ?? "").trim().toLowerCase();

    // Validated here as well as in the database, so the player gets the actual
    // reason rather than a generic failure from a constraint violation.
    const reason = handleRejectionReason(requested);
    if (reason) redirect(`/settings?error=${encodeURIComponent(reason)}`);

    if (requested === current.handle) redirect("/settings?saved=1");

    const result = await updateHandle(current.id, requested);
    if (!result.ok) redirect(`/settings?error=${encodeURIComponent(result.error)}`);

    // The old handle's page and every board linking to it are now stale.
    revalidatePath("/leaderboard");
    revalidatePath(`/u/${requested}`);
    redirect("/settings?saved=1");
  }

  return (
    <Shell>
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-medium tracking-tight">Settings</h1>
        <p className="text-sm text-muted">
          Your public page is{" "}
          <Link
            href={`/u/${profile.handle}`}
            className="text-foreground underline underline-offset-4"
          >
            /u/{profile.handle}
          </Link>
        </p>
      </div>

      <form action={save} className="flex max-w-sm flex-col gap-3">
        <label htmlFor="handle" className="text-[10px] uppercase tracking-widest text-muted-dim">
          Handle
        </label>
        <input
          id="handle"
          name="handle"
          defaultValue={profile.handle}
          maxLength={24}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          className="rounded-lg border border-border bg-surface px-3 py-2 font-mono text-sm text-foreground outline-none focus:border-muted-dim"
        />
        <p className="text-xs leading-relaxed text-muted-dim">
          3–24 characters: lowercase letters, numbers, hyphens and underscores.
          Changing it changes your profile URL, so old links stop working.
        </p>

        {error ? <p className="text-xs text-danger">{error}</p> : null}
        {saved ? <p className="text-xs text-ready">Saved.</p> : null}

        <button
          type="submit"
          className="self-start rounded-lg bg-foreground px-5 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90"
        >
          Save
        </button>
      </form>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col">
      <SiteHeader active="progress" />
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-6 pb-20 pt-6">
        {children}
      </div>
    </main>
  );
}
