"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { track } from "@/lib/analytics";
import { createPasskey, passkeysSupported } from "@/lib/passkeyClient";
import { forgetSession } from "@/lib/useSession";

/**
 * The account controls Clerk's `UserButton` used to provide: sign out, the
 * passkeys that can open this account, and the devices currently signed in.
 *
 * Losing that menu is what made this necessary — but it is also the better
 * arrangement. A dropdown that opens a hosted modal put the most consequential
 * screen in the product behind two clicks and a third party's styling. This is
 * a page, it is linked from the header, and everything on it is ours.
 *
 * ## The list is never invented
 *
 * If the passkeys or the devices cannot be read, the panel says so rather than
 * rendering an empty list. "You have no other passkeys" is the answer somebody
 * uses to decide whether it is safe to remove one, and "no devices are signed
 * in" is what somebody checks when they think their account was taken. Both are
 * answers that must never be guessed.
 */

export interface PasskeyRow {
  id: string;
  label: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  backedUp: boolean | null;
}

export interface DeviceRow {
  id: string;
  userAgent: string | null;
  lastSeenAt: string;
  current: boolean;
}

export function AccountPanel({
  email,
  emailVerified,
  passkeys,
  devices,
  readFailed,
}: {
  email: string;
  emailVerified: boolean;
  passkeys: PasskeyRow[];
  devices: DeviceRow[];
  readFailed: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [canAdd, setCanAdd] = useState(false);

  useEffect(() => {
    setCanAdd(passkeysSupported());
  }, []);

  async function addPasskey() {
    setBusy(true);
    setError(null);
    const result = await createPasskey(deviceName());
    setBusy(false);
    if (result.ok) {
      track("passkey_added", { at: "settings" });
      router.refresh();
      return;
    }
    if (!result.cancelled) setError(result.error);
  }

  async function removePasskey(id: string) {
    setBusy(true);
    setError(null);
    const response = await fetch("/api/auth/passkey/remove", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ passkeyId: id }),
    });
    setBusy(false);
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? "Could not remove that passkey.");
      return;
    }
    router.refresh();
  }

  async function signOut() {
    setBusy(true);
    await fetch("/api/auth/sign-out", { method: "POST" });
    // The cached answer has to go, or the header keeps showing an account until
    // a full reload — which reads as the sign-out not having worked.
    forgetSession();
    router.refresh();
    router.push("/");
  }

  return (
    <div className="flex flex-col gap-10">
      <section className="flex flex-col gap-3">
        <h2 className="text-[10px] uppercase tracking-widest text-muted-dim">Account</h2>
        <p className="font-mono text-sm">{email}</p>
        {emailVerified ? (
          <p className="text-xs text-muted-dim">
            Confirmed. This is how you get back in if you lose your passkeys.
          </p>
        ) : (
          <p className="text-xs text-holding">
            Not confirmed yet. Until it is, there is no way to prove this account
            is yours if you lose your passkey — check your inbox.
          </p>
        )}
      </section>

      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}

      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-[10px] uppercase tracking-widest text-muted-dim">Passkeys</h2>
          {canAdd ? (
            <button
              type="button"
              onClick={addPasskey}
              disabled={busy}
              className="rounded-md border border-border px-2.5 py-1 text-xs text-muted transition-colors hover:border-muted-dim hover:text-foreground disabled:opacity-50"
            >
              {busy ? "Waiting…" : "Add a passkey"}
            </button>
          ) : null}
        </div>

        {readFailed ? (
          <p className="rounded-lg border border-dashed border-border px-4 py-4 text-xs text-danger">
            Your passkeys could not be loaded. This is not the same as having
            none — do not remove anything until this page loads properly.
          </p>
        ) : passkeys.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-4 py-4 text-xs text-muted">
            None yet. A passkey signs you in with your face, fingerprint or
            device PIN — nothing to remember and nothing for us to leak.
          </p>
        ) : (
          <ul className="flex flex-col gap-px overflow-hidden rounded-lg border border-border bg-border">
            {passkeys.map((passkey) => (
              <li
                key={passkey.id}
                className="flex flex-wrap items-center justify-between gap-3 bg-surface px-4 py-3"
              >
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm">{passkey.label ?? "Passkey"}</span>
                  <span className="text-xs text-muted-dim">
                    Added {shortDate(passkey.createdAt)}
                    {passkey.lastUsedAt ? ` · last used ${shortDate(passkey.lastUsedAt)}` : " · never used"}
                    {passkey.backedUp === false ? " · on this device only" : ""}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => removePasskey(passkey.id)}
                  disabled={busy}
                  className="text-xs text-muted-dim underline underline-offset-4 transition-colors hover:text-danger disabled:opacity-50"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}

        {passkeys.some((passkey) => passkey.backedUp === false) ? (
          <p className="max-w-lg text-xs leading-relaxed text-muted-dim">
            A passkey marked <em>on this device only</em> does not sync. Lose the
            device and it is gone — add a second one somewhere else.
          </p>
        ) : null}
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-[10px] uppercase tracking-widest text-muted-dim">
          Where you are signed in
        </h2>

        {readFailed ? (
          <p className="rounded-lg border border-dashed border-border px-4 py-4 text-xs text-danger">
            Could not load your devices. Nothing here should be read as
            &ldquo;no other device is signed in&rdquo;.
          </p>
        ) : (
          <ul className="flex flex-col gap-px overflow-hidden rounded-lg border border-border bg-border">
            {devices.map((device) => (
              <li key={device.id} className="flex flex-col gap-0.5 bg-surface px-4 py-3">
                <span className="text-sm">
                  {describeAgent(device.userAgent)}
                  {device.current ? (
                    <span className="ml-2 text-xs text-ready">this device</span>
                  ) : null}
                </span>
                <span className="text-xs text-muted-dim">
                  Last seen {shortDate(device.lastSeenAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <button
          type="button"
          onClick={signOut}
          disabled={busy}
          className="self-start rounded-lg border border-border px-5 py-2 text-sm transition-colors hover:border-danger hover:text-danger disabled:opacity-50"
        >
          Sign out
        </button>
      </section>
    </div>
  );
}

/** A name for the passkey, seeded from the device so the list is readable. */
function deviceName(): string {
  if (typeof navigator === "undefined") return "This device";
  const agent = navigator.userAgent;
  if (/iPhone/.test(agent)) return "iPhone";
  if (/iPad/.test(agent)) return "iPad";
  if (/Android/.test(agent)) return "Android";
  if (/Mac OS X/.test(agent)) return "Mac";
  if (/Windows/.test(agent)) return "Windows";
  if (/Linux/.test(agent)) return "Linux";
  return "This device";
}

/**
 * Enough of a user agent to recognise a device, and no more.
 *
 * Printing the raw string would be both unreadable and a small hazard: it is
 * attacker-controlled text rendered on a page. React escapes it, but there is
 * no reason to show ninety characters of version numbers to somebody trying to
 * spot a device they do not own.
 */
function describeAgent(agent: string | null): string {
  if (!agent) return "Unknown device";
  const os = /iPhone/.test(agent)
    ? "iPhone"
    : /iPad/.test(agent)
      ? "iPad"
      : /Android/.test(agent)
        ? "Android"
        : /Mac OS X/.test(agent)
          ? "Mac"
          : /Windows/.test(agent)
            ? "Windows"
            : /Linux/.test(agent)
              ? "Linux"
              : "Unknown device";

  const browser = /Edg\//.test(agent)
    ? "Edge"
    : /OPR\//.test(agent)
      ? "Opera"
      : /Firefox\//.test(agent)
        ? "Firefox"
        : /Chrome\//.test(agent)
          ? "Chrome"
          : /Safari\//.test(agent)
            ? "Safari"
            : null;

  return browser ? `${os} · ${browser}` : os;
}

function shortDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "unknown";
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
