"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Reveal } from "@/components/Reveal";
import { SiteHeader } from "@/components/SiteHeader";
import { track } from "@/lib/analytics";
import { passkeysSupported, signInWithPasskey } from "@/lib/passkeyClient";

/**
 * Signing in.
 *
 * The passkey is the first thing on the page and it asks for nothing — no
 * address, no password, one tap. That is not only nicer, it is more private:
 * requesting a passkey by address would mean the server answering "which
 * credentials does this address have", which is an enumeration oracle. Because
 * registration asks for a discoverable credential, the authenticator already
 * knows what it holds for this site.
 *
 * The password form is underneath and deliberately plain. It exists for
 * browsers and devices that cannot do the first thing, and for anybody who set
 * one up.
 *
 * ## Every failure says the same thing
 *
 * A wrong password, an address with no account, and an account that only has a
 * passkey all produce one message. Being more helpful would answer "does this
 * person have an account here?" to whoever asks, which turns a leaked address
 * list into a list of this site's users. The server enforces this; the screen
 * simply shows what it is told rather than elaborating.
 */
export function SignInScreen() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<"passkey" | "password" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [canUsePasskeys, setCanUsePasskeys] = useState(false);

  useEffect(() => {
    setCanUsePasskeys(passkeysSupported());
  }, []);

  async function usePasskey() {
    setBusy("passkey");
    setError(null);

    const result = await signInWithPasskey();
    setBusy(null);

    if (result.ok) {
      track("signin", { method: "passkey" });
      // `refresh()` before navigating, so the server components re-render with
      // the new session cookie. Without it the destination can paint its
      // signed-out shell from the router cache, which reads exactly like the
      // sign-in having failed.
      router.refresh();
      router.push("/progress");
      return;
    }
    // Cancelling a system prompt is not an error worth colouring red.
    if (!result.cancelled) setError(result.error);
  }

  async function usePassword(event: React.FormEvent<HTMLFormElement>) {
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
    const form = new FormData(event.currentTarget);
    const submittedEmail = String(form.get("email") ?? "").trim();
    const submittedPassword = String(form.get("password") ?? "");
    if (!submittedEmail || !submittedPassword) return;

    setBusy("password");
    setError(null);

    const response = await fetch("/api/auth/sign-in", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: submittedEmail, password: submittedPassword }),
    });

    setBusy(null);

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? "That didn't work.");
      return;
    }

    track("signin", { method: "password" });
    router.refresh();
    router.push("/progress");
  }

  return (
    <main className="flex min-h-dvh flex-col">
      <SiteHeader active="progress" />

      <div className="mx-auto flex w-full max-w-sm flex-1 flex-col gap-8 px-6 pb-24 pt-12">
        <Reveal className="flex flex-col gap-2">
          <h1 className="text-3xl font-medium leading-tight tracking-tight">
            Sign in
          </h1>
          <p className="text-sm leading-relaxed text-muted">
            You do not need an account to solve.{" "}
            <Link href="/timer" className="text-foreground underline underline-offset-4">
              Start cubing
            </Link>{" "}
            without one.
          </p>
        </Reveal>

        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}

        {canUsePasskeys ? (
          <Reveal className="flex flex-col gap-3">
            <button
              type="button"
              onClick={usePasskey}
              disabled={busy !== null}
              className="rounded-lg bg-foreground px-6 py-3 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {busy === "passkey" ? "Waiting for your device…" : "Sign in with a passkey"}
            </button>
            <p className="text-xs leading-relaxed text-muted-dim">
              Your face, fingerprint or device PIN. Nothing to type and nothing
              to remember.
            </p>

            <div className="flex items-center gap-3 py-2" aria-hidden>
              <span className="h-px flex-1 bg-border" />
              <span className="text-xs uppercase tracking-[0.14em] text-muted-dim">or</span>
              <span className="h-px flex-1 bg-border" />
            </div>
          </Reveal>
        ) : null}

        <Reveal>
          <form onSubmit={usePassword} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <label htmlFor="email" className="text-sm font-medium">
                Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                required
                autoComplete="username webauthn"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="w-full rounded-lg border border-border bg-surface px-4 py-3 text-sm outline-none transition-colors placeholder:text-muted-dim focus-visible:border-muted-dim"
                placeholder="you@example.com"
              />
            </div>

            <div className="flex flex-col gap-2">
              <label htmlFor="password" className="text-sm font-medium">
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="w-full rounded-lg border border-border bg-surface px-4 py-3 text-sm outline-none transition-colors placeholder:text-muted-dim focus-visible:border-muted-dim"
              />
            </div>

            <button
              type="submit"
              disabled={busy !== null}
              className="rounded-lg border border-border px-6 py-3 text-sm font-medium transition-colors hover:border-muted-dim disabled:opacity-50"
            >
              {busy === "password" ? "Checking…" : "Sign in"}
            </button>
          </form>
        </Reveal>

        <Reveal className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-dim">
          <Link href="/forgot" className="underline underline-offset-4 transition-colors hover:text-foreground">
            Forgot your password?
          </Link>
          <Link href="/join" className="underline underline-offset-4 transition-colors hover:text-foreground">
            Make an account
          </Link>
        </Reveal>
      </div>
    </main>
  );
}
