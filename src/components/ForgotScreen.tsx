"use client";

import Link from "next/link";
import { useState } from "react";

import { Reveal } from "@/components/Reveal";
import { AuthShell } from "@/components/AuthShell";
import { SiteHeader } from "@/components/SiteHeader";

/**
 * Asking for a reset link.
 *
 * The confirmation is deliberately worded as a conditional — *if that address
 * has an account* — and it says the same thing either way. Anything more
 * definite would answer "is this person registered here?" to whoever typed the
 * address, which turns a leaked address list into a list of this site's users.
 *
 * It is also simply true. The server defers the work until after the response,
 * so at the moment this message is shown nobody knows yet whether a mail went
 * out. Claiming "we've sent you an email" would be a guess as well as a leak.
 */
export function ForgotScreen() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Read from the form, not from React state.
    //
    // A controlled input's state is empty until the component hydrates, while
    // the DOM value is whatever the person typed. Somebody who types and
    // submits in that window passes the browser's `required` check — the DOM
    // has a value — and sends an empty string, because the handler was reading
    // state. On this endpoint that produces a cheerful "check your inbox" for a
    // request that did nothing at all.
    //
    // `FormData` reads the DOM, so the two can never disagree.
    const submitted = String(new FormData(event.currentTarget).get("email") ?? "").trim();
    if (!submitted) return;

    setBusy(true);
    setError(null);

    const response = await fetch("/api/auth/forgot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: submitted }),
    });

    setBusy(false);

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? "Could not do that right now.");
      return;
    }
    setSent(true);
  }

  return (
    <main className="flex min-h-dvh flex-col">
      <SiteHeader active="progress" />

      <AuthShell>
        {sent ? (
          <Reveal className="flex flex-col gap-4">
            <h1 className="text-2xl tracking-tight">Check your inbox</h1>
            <p className="text-sm leading-relaxed text-muted">
              If that address has an account, a link is on its way. It works once
              and expires in thirty minutes.
            </p>
            <p className="text-xs leading-relaxed text-muted-dim">
              Using it signs out every device currently signed in — including
              anyone who should not be.
            </p>
            <Link
              href="/sign-in"
              className="self-start text-xs text-muted-dim underline underline-offset-4 transition-colors hover:text-foreground"
            >
              Back to sign in
            </Link>
          </Reveal>
        ) : (
          <>
            <Reveal className="flex flex-col gap-2">
              <h1 className="text-3xl leading-tight tracking-tight">
                Forgot your password?
              </h1>
              <p className="text-sm leading-relaxed text-muted">
                We&rsquo;ll email you a link. If you have a passkey, you do not
                need this —{" "}
                <Link href="/sign-in" className="text-foreground underline underline-offset-4">
                  use that instead
                </Link>
                .
              </p>
            </Reveal>

            <Reveal>
              <form onSubmit={submit} className="flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <label htmlFor="email" className="text-sm font-medium">
                    Email
                  </label>
                  <input
                    id="email"
                    name="email"
                    type="email"
                    required
                    autoComplete="username"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full rounded-lg border border-border bg-surface px-4 py-3 text-sm outline-none transition-colors placeholder:text-muted-dim focus-visible:border-muted-dim"
                    placeholder="you@example.com"
                  />
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
                  {busy ? "Sending…" : "Email me a link"}
                </button>
              </form>
            </Reveal>
          </>
        )}
      </AuthShell>
    </main>
  );
}
