"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Reveal } from "@/components/Reveal";
import { AuthShell } from "@/components/AuthShell";
import { SiteHeader } from "@/components/SiteHeader";
// From `passwordPolicy`, never from `password`. That module imports
// `node:crypto` and `node:util`; pulling a single constant from it into a
// client component bundles the whole thing, `promisify` throws on load, and
// this page renders nothing — which is how `/reset` shipped with no form on it.
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/passwordPolicy";

/**
 * Setting a new password from an emailed link.
 *
 * A form that POSTs, never something that happens on arrival. Mail clients and
 * corporate link scanners fetch every URL in a message before a human sees it,
 * so a page that changed a password on load would have it changed by a machine
 * — and the person would arrive to find their link already spent.
 *
 * The token stays in the URL and is never put in a field the person can see or
 * edit. There is nothing for them to do with it and showing it would only
 * invite pasting it somewhere.
 */
export function ResetScreen({ token }: { token: string | null }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) return;

    // Read from the form, not from React state — a controlled input's state is
    // empty until the component hydrates while the DOM value is not, so a fast
    // typist can pass `required` and submit nothing. See ForgotScreen.
    const submitted = String(new FormData(event.currentTarget).get("password") ?? "");
    if (!submitted) return;

    setBusy(true);
    setError(null);

    const response = await fetch("/api/auth/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password: submitted }),
    });

    setBusy(false);

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? "Could not set that password.");
      return;
    }
    setDone(true);
  }

  return (
    <main className="flex min-h-dvh flex-col">
      <SiteHeader active="home" />

      <AuthShell>
        {!token ? (
          <Reveal className="flex flex-col gap-3">
            <h1 className="text-2xl tracking-tight">
              That link is incomplete
            </h1>
            <p className="text-sm leading-relaxed text-muted">
              It may have been broken across two lines by your mail client. Copy
              the whole thing, or{" "}
              <Link href="/forgot" className="text-foreground underline underline-offset-4">
                ask for a new one
              </Link>
              .
            </p>
          </Reveal>
        ) : done ? (
          <Reveal className="flex flex-col gap-4">
            <h1 className="text-2xl tracking-tight">Password changed</h1>
            <p className="text-sm leading-relaxed text-muted">
              Every device that was signed in has been signed out, including this
              one. Sign in with your new password.
            </p>
            <button
              type="button"
              onClick={() => router.push("/sign-in")}
              className="btn-go self-start px-6 py-3 text-sm"
            >
              Sign in
            </button>
          </Reveal>
        ) : (
          <>
            <Reveal className="flex flex-col gap-2">
              <h1 className="text-3xl leading-tight tracking-tight">
                Choose a new password
              </h1>
              <p className="text-sm leading-relaxed text-muted">
                Setting it signs out every device currently signed in.
              </p>
            </Reveal>

            <Reveal>
              <form onSubmit={submit} className="flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <label htmlFor="password" className="text-sm font-medium">
                    New password
                  </label>
                  <input
                    id="password"
                    name="password"
                    type="password"
                    required
                    autoComplete="new-password"
                    minLength={MIN_PASSWORD_LENGTH}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full rounded-lg border border-border bg-surface px-4 py-3 text-sm outline-none transition-colors placeholder:text-muted-dim focus-visible:border-muted-dim"
                    placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
                  />
                  <p className="text-xs leading-relaxed text-muted-dim">
                    Length is what helps. No required symbols, no forced capital
                    — those push people toward passwords they write down.
                  </p>
                </div>

                {error ? (
                  <p role="alert" className="text-sm text-danger">
                    {error}
                  </p>
                ) : null}

                <button
                  type="submit"
                  disabled={busy}
                  className="btn-go px-6 py-3 text-sm disabled:opacity-50"
                >
                  {busy ? "Saving…" : "Set password"}
                </button>
              </form>
            </Reveal>
          </>
        )}
      </AuthShell>
    </main>
  );
}
