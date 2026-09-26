import type { Metadata } from "next";
import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { AccountPanel, type DeviceRow, type PasskeyRow } from "@/components/AccountPanel";
import { CubePicker } from "@/components/CubePicker";
import { PageHero } from "@/components/PageHero";
import { WcaPanel } from "@/components/WcaPanel";
import { SiteHeader } from "@/components/SiteHeader";
import { handleRejectionReason } from "@/lib/handle";
import { currentSession } from "@/lib/server/currentUser";
import { EVENTS, type EventId } from "@/lib/events";
import { listPasskeys } from "@/lib/server/passkeys";
import { isEstablished, msForRating } from "@/lib/rating";
import { currentRating } from "@/lib/server/ranked";
import { linkFor, wcaConfigured } from "@/lib/server/wca";
import { compare, type Comparison, type WcaRecord } from "@/lib/wca";
import { ensureProfile, updateHandle } from "@/lib/server/profiles";
import { listSessions } from "@/lib/server/sessions";
import { isDatabaseConfigured } from "@/lib/server/supabase";

export const metadata: Metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

/**
 * Where a player fixes the handle they were given.
 *
 * New accounts are seeded with a handle derived from their email address,
 * because stopping someone at a naming form before they have seen the product is
 * the reliable way to lose them. The cost of that choice is that the name they
 * end up with may not be one they chose — so changing it has to be easy, obvious,
 * and reachable from the account menu rather than buried.
 */
export default async function SettingsPage(props: PageProps<"/settings">) {
  // The cube's look lives in this browser, so it is offered to everybody.
  // It used to be shown only to the signed in, which left everyone else with
  // no way to change it anywhere on the site.
  if (!isDatabaseConfigured()) {
    return (
      <Shell>
        <SettingsHero>How the cube looks on this device.</SettingsHero>
        <CubeSection />
        <p className="text-sm text-muted">Accounts are not configured for this deployment.</p>
      </Shell>
    );
  }

  const profile = await ensureProfile();
  if (!profile) {
    return (
      <Shell>
        <SettingsHero>How the cube looks on this device, and — once you have an account — your handle and how you sign in.</SettingsHero>
        <CubeSection />
        <section data-testid="settings-account-gate" className="flex max-w-xl flex-col gap-3 rounded-2xl border border-border bg-surface p-5 sm:p-6">
          <h2 className="text-lg tracking-tight">Account</h2>
          <p className="text-sm leading-relaxed text-muted">
            Your handle and public page, passkeys, the devices you are signed in on and a WCA link all belong to an
            account. Solving never needs one.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link href="/sign-in?next=/settings" className="btn-go px-5 py-2.5 text-sm">
              Sign in or create an account
            </Link>
          </div>
        </section>
      </Shell>
    );
  }

  const session = await currentSession();

  // Read together, and a failure of either is reported rather than rendered as
  // an empty list. "You have no other passkeys" is what somebody uses to decide
  // whether removing one is safe, and "no other device is signed in" is what
  // somebody checks when they think their account was taken — neither may be
  // guessed. `listPasskeys` and `listSessions` both throw on a read error for
  // exactly this reason.
  let passkeys: PasskeyRow[] = [];
  let devices: DeviceRow[] = [];
  let readFailed = false;
  if (session) {
    try {
      passkeys = (await listPasskeys(session.user.id)).map((passkey) => ({
        id: passkey.id,
        label: passkey.label,
        createdAt: passkey.createdAt,
        lastUsedAt: passkey.lastUsedAt,
        backedUp: passkey.backedUp,
      }));
      devices = (await listSessions(session.user.id)).map((device) => ({
        id: device.id,
        userAgent: device.userAgent,
        lastSeenAt: device.lastSeenAt,
        current: device.id === session.session.id,
      }));
    } catch {
      readFailed = true;
    }
  }

  // The WCA panel. Every failure here degrades to "not linked" rather than
  // breaking the page: this sits below the handle form and the account
  // controls, and a third party being unreachable must not take those with it.
  const wcaAvailable = wcaConfigured();
  let link: Awaited<ReturnType<typeof linkFor>> = null;
  const comparisons: { event: EventId; comparison: Comparison }[] = [];

  if (wcaAvailable) {
    try {
      link = await linkFor(profile.id);
    } catch {
      link = null;
    }
  }

  if (link) {
    const records = link.records as Partial<Record<EventId, WcaRecord>>;
    for (const event of Object.keys(EVENTS) as EventId[]) {
      const record = records[event];

      // The rating converts back to the average that earned it, exactly — that
      // is the whole design of the scale — so there is no separate stored time
      // to read. Shown only when the ladder would publish it, using the same
      // `isEstablished` rule the leaderboard applies: a provisional number
      // beside a competition average would invite a comparison the ladder is
      // not yet willing to make.
      let cubeduelMs: number | null = null;
      try {
        const standing = await currentRating(profile.id, event, "keyboard");
        if (standing.rating !== null && isEstablished(standing)) {
          cubeduelMs = msForRating(standing.rating, event);
        }
      } catch {
        cubeduelMs = null;
      }

      // Listed only when there is something to show on one side or the other.
      // An event nobody has ever done is not a comparison, it is a blank row.
      if (record?.averageMs == null && cubeduelMs === null) continue;

      comparisons.push({
        event,
        comparison: compare({ event, pool: "keyboard", cubeduelMs, record }),
      });
    }
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
      <SettingsHero>
        Your public page is{" "}
        <Link href={`/u/${profile.handle}`} className="text-foreground underline underline-offset-4">
          /u/{profile.handle}
        </Link>
      </SettingsHero>

      <form action={save} className="flex max-w-sm flex-col gap-3">
        <label htmlFor="handle" className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-dim">
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
          className="btn-go self-start px-5 py-2 text-sm"
        >
          Save
        </button>
      </form>

      <CubeSection />

      <WcaPanel
        configured={wcaAvailable}
        link={link}
        comparisons={comparisons}
        outcome={typeof params.wca === "string" ? params.wca : null}
      />

      <AccountPanel
        email={session?.user.email ?? ""}
        emailVerified={session?.user.emailVerifiedAt !== null}
        passkeys={passkeys}
        devices={devices}
        readFailed={readFailed}
      />
    </Shell>
  );
}

function SettingsHero({ children }: { children: React.ReactNode }) {
  return <PageHero title="Settings">{children}</PageHero>;
}

function CubeSection() {
  return (
    <section className="flex flex-col gap-4" data-testid="settings-cube">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg tracking-tight">Your cube</h2>
        <p className="max-w-lg text-sm leading-relaxed text-muted">
          Applies everywhere a cube is drawn — the timer, the daily, duels and the trainer. Kept in this browser.
        </p>
      </div>
      <CubePicker />
    </section>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col">
      <SiteHeader active="home" />
      <div className="page-frame flex w-full max-w-3xl flex-1 flex-col gap-8 px-4 pb-24 pt-6 sm:px-8 lg:pt-12">
        {children}
      </div>
    </main>
  );
}
