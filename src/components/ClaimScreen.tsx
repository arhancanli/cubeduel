"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { Reveal } from "@/components/Reveal";
import { AuthShell } from "@/components/AuthShell";
import { SiteHeader } from "@/components/SiteHeader";
import {
  MIN_SOLVES_TO_PROJECT,
  SOLVES_TO_ESTABLISH,
  headlineFor,
  summariseClaim,
  type ClaimSummary,
} from "@/lib/claim";
import { nextFromLocation } from "@/lib/nextPath";
import { formatMs } from "@/lib/format";
import { track, trackOnce } from "@/lib/analytics";
import { createPasskey, passkeysSupported } from "@/lib/passkeyClient";
import { loadHistory } from "@/lib/solveHistory";

/**
 * The moment somebody is asked for an account.
 *
 * It is deliberately not a form with a headline above it. By the time anybody
 * reaches this page they have already solved — the whole product is built so
 * that they can — and everything they have done is sitting in their browser and
 * nowhere else. So the page leads with that: the count, the best, the shape of
 * their solve, and where their pace would put them on the ladder. The account
 * is the thing that keeps it.
 *
 * ## The line this screen must not cross
 *
 * The projected rating is not a rating and is never allowed to look like one.
 * It comes from practice solves that nobody verified, and the entire claim of
 * the ladder is that a number on it means something. So it is labelled
 * "projected", it sits next to a plain sentence saying what it is not, and the
 * real threshold — twenty verified solves — is stated rather than implied.
 *
 * Presenting it as an achievement would be the single most damaging thing this
 * product could do, and it would be very easy to do by accident while making
 * the page feel better.
 *
 * ## Somebody with nothing to claim
 *
 * They get a plain sign-up instead, and the pitch does not pretend. Inventing
 * enthusiasm about an empty history is worse than a clean form.
 */

const PHASE_TINT: Record<string, string> = {
  Cross: "bg-[#6d6d78]",
  F2L: "bg-[#8f8f9b]",
  OLL: "bg-[#b4b4bf]",
  PLL: "bg-[#d8d8e0]",
};

export function ClaimScreen() {
  const router = useRouter();

  const [summary, setSummary] = useState<ClaimSummary | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<"form" | "passkey">("form");
  const [canUsePasskeys, setCanUsePasskeys] = useState(false);

  // Read once on mount. History lives in localStorage, which does not exist
  // during the server render — reading it in a render body would make the two
  // passes disagree and throw a hydration error.
  useEffect(() => {
    // Bests and the rating estimate are a 3x3's.
    const claim = summariseClaim(loadHistory("333"));
    setSummary(claim);
    setCanUsePasskeys(passkeysSupported());

    // Whether the page was worth showing is the interesting half. A visitor who
    // arrives here with nothing to claim is being asked to sign up for reasons
    // this screen cannot make, and the two cases convert very differently.
    trackOnce("join_view", { hasClaim: claim.worthClaiming, solves: claim.solveCount });
  }, []);

  const headline = useMemo(
    () => (summary ? headlineFor(summary, formatMs) : null),
    [summary],
  );

  const emailRef = useRef<HTMLInputElement>(null);

  async function createAccount(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;

    // Read from the form, not from React state — a controlled input's state is
    // empty until the component hydrates while the DOM value is not, so a fast
    // typist can pass `required` and submit nothing. See ForgotScreen.
    const form = new FormData(event.currentTarget);
    const submittedEmail = String(form.get("email") ?? "").trim();
    const submittedPassword = String(form.get("password") ?? "");
    if (!submittedEmail) return;

    setBusy(true);
    setError(null);

    const response = await fetch("/api/auth/sign-up", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: submittedEmail,
        // Omitted entirely rather than sent empty, so the account is created
        // with no password at all and the passkey becomes its only credential.
        ...(showPassword && submittedPassword ? { password: submittedPassword } : {}),
      }),
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? "Could not create that account.");
      setBusy(false);
      return;
    }

    setBusy(false);
    track("signup", { withPassword: Boolean(showPassword && submittedPassword) });

    // Signed in already. The passkey step is an offer, not a gate — somebody who
    // skips it still has an account and still keeps their solves.
    setStage(canUsePasskeys ? "passkey" : "form");
    if (!canUsePasskeys) router.push(nextFromLocation("/progress"));
  }

  async function addPasskey() {
    setBusy(true);
    setError(null);

    const result = await createPasskey();
    setBusy(false);

    if (result.ok) {
      track("passkey_added", { at: "signup" });
      router.push(nextFromLocation("/progress"));
      return;
    }
    // Cancelling is not a failure. The account exists either way, so the only
    // honest response is to stop talking about it.
    if (!result.cancelled) setError(result.error);
  }

  return (
    <main className="flex min-h-dvh flex-col">
      <SiteHeader active="progress" />

      <AuthShell>
        {summary?.worthClaiming ? (
          <Reveal className="flex flex-col gap-8">
            <div className="flex flex-col gap-3">
              <p className="text-xs uppercase tracking-[0.18em] text-muted-dim">
                Your session so far
              </p>
              <h1 className="text-balance text-3xl leading-tight tracking-tight sm:text-4xl">
                Keep this.
              </h1>
              <p className="max-w-lg text-balance text-sm leading-relaxed text-muted">
                Everything below is in this browser and nowhere else. Clear your
                history, switch device, or open a private window and it is gone.
                An account is what carries it.
              </p>
            </div>

            {headline ? (
              <div className="flex flex-col gap-1 rounded-xl border border-border bg-surface px-6 py-6">
                <span className="font-mono text-5xl font-medium tracking-tight tabular-nums sm:text-6xl">
                  {headline.value}
                </span>
                <span className="text-xs uppercase tracking-[0.16em] text-muted-dim">
                  {headline.label}
                </span>

                {summary.projectedRating !== null ? (
                  <p className="mt-4 max-w-md text-xs leading-relaxed text-muted-dim">
                    This is where your pace <em>would</em> put you — not a rating
                    you hold. Ratings come from solves the server issued a
                    scramble for and replayed afterwards, and it takes about{" "}
                    {SOLVES_TO_ESTABLISH} of those before one is published at all.
                  </p>
                ) : (
                  <p className="mt-4 max-w-md text-xs leading-relaxed text-muted-dim">
                    {projectionHint(summary.turnedCount, summary.solveCount)}
                  </p>
                )}
              </div>
            ) : null}

            <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-4">
              <Stat label="Solves" value={String(summary.solveCount)} />
              <Stat
                label={summary.dayCount === 1 ? "Day" : "Days"}
                value={String(summary.dayCount)}
              />
              <Stat
                label="Best"
                value={summary.bestSingle !== null ? formatMs(summary.bestSingle) : "—"}
              />
              <Stat label="At the cube" value={humaniseDuration(summary.totalMs)} />
            </dl>

            {summary.shape.length > 0 ? (
              <div className="flex flex-col gap-3">
                <div className="flex items-baseline justify-between gap-2">
                  <h2 className="text-sm tracking-tight">
                    The shape of your solve
                  </h2>
                  <p className="text-xs text-muted-dim">
                    Averaged across every solve we could split
                  </p>
                </div>

                <div
                  className="flex h-3 w-full overflow-hidden rounded-full"
                  role="img"
                  aria-label={summary.shape
                    .map(
                      (part) =>
                        `${part.phase} ${Math.round(part.share * 100)} percent`,
                    )
                    .join(", ")}
                >
                  {summary.shape.map((part) => (
                    <div
                      key={part.phase}
                      className={PHASE_TINT[part.phase] ?? "bg-bar"}
                      style={{ width: `${part.share * 100}%` }}
                    />
                  ))}
                </div>

                <ul className="flex flex-wrap gap-x-5 gap-y-2">
                  {summary.shape.map((part) => (
                    <li key={part.phase} className="flex items-center gap-2 text-xs">
                      <span
                        aria-hidden
                        className={`h-2 w-2 rounded-full ${PHASE_TINT[part.phase] ?? "bg-bar"}`}
                      />
                      <span className="text-muted">{part.phase}</span>
                      <span className="font-mono tabular-nums text-muted-dim">
                        {Math.round(part.share * 100)}%
                      </span>
                    </li>
                  ))}
                </ul>

                <p className="max-w-lg text-xs leading-relaxed text-muted-dim">
                  No other cubing site can show you this, because no other one
                  reads your move stream. It is also the thing that tells you
                  what to practise.
                </p>
              </div>
            ) : null}
          </Reveal>
        ) : (
          <Reveal className="flex flex-col gap-3">
            <h1 className="text-3xl leading-tight tracking-tight sm:text-4xl">
              Make an account
            </h1>
            <p className="max-w-lg text-balance text-sm leading-relaxed text-muted">
              An account carries your solves between devices, and it is what a
              rating belongs to. You do not need one to solve —{" "}
              <Link href="/timer" className="text-foreground underline underline-offset-4">
                start cubing instead
              </Link>
              .
            </p>
          </Reveal>
        )}

        <Reveal className="flex flex-col gap-4">
          {stage === "passkey" ? (
            <PasskeyStep busy={busy} error={error} onAdd={addPasskey} onSkip={() => router.push(nextFromLocation("/progress"))} />
          ) : (
            <form onSubmit={createAccount} className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <label htmlFor="email" className="text-sm font-medium">
                  Email
                </label>
                <input
                  ref={emailRef}
                  id="email"
                  name="email"
                  type="email"
                  required
                  autoComplete="username"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className="w-full rounded-lg border border-border bg-surface px-4 py-3 text-sm outline-none transition-colors placeholder:text-muted-dim focus-visible:border-muted-dim"
                  placeholder="you@example.com"
                />
                <p className="text-xs leading-relaxed text-muted-dim">
                  Used to get you back in if you lose your passkey. Nothing else.
                </p>
              </div>

              {showPassword ? (
                <div className="flex flex-col gap-2">
                  <label htmlFor="password" className="text-sm font-medium">
                    Password
                  </label>
                  <input
                    id="password"
                    name="password"
                    type="password"
                    autoComplete="new-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    className="w-full rounded-lg border border-border bg-surface px-4 py-3 text-sm outline-none transition-colors placeholder:text-muted-dim focus-visible:border-muted-dim"
                    placeholder="At least 8 characters"
                  />
                </div>
              ) : null}

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
                {busy
                  ? "Just a moment…"
                  : summary?.worthClaiming
                    ? "Claim my solves"
                    : "Create account"}
              </button>

              <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-dim">
                <button
                  type="button"
                  onClick={() => setShowPassword((current) => !current)}
                  className="underline underline-offset-4 transition-colors hover:text-foreground"
                >
                  {showPassword ? "Use a passkey instead" : "Set a password instead"}
                </button>
                <Link
                  href="/sign-in"
                  className="underline underline-offset-4 transition-colors hover:text-foreground"
                >
                  Already have an account?
                </Link>
              </div>
            </form>
          )}
        </Reveal>
      </AuthShell>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 bg-surface px-4 py-4">
      <dd className="font-mono text-xl font-medium tabular-nums">{value}</dd>
      <dt className="text-xs uppercase tracking-[0.14em] text-muted-dim">{label}</dt>
    </div>
  );
}

function PasskeyStep({
  busy,
  error,
  onAdd,
  onSkip,
}: {
  busy: boolean;
  error: string | null;
  onAdd: () => void;
  onSkip: () => void;
}) {
  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border bg-surface px-6 py-6">
      <div className="flex flex-col gap-2">
        <h2 className="text-lg tracking-tight">
          Your solves are safe. Now lock the account.
        </h2>
        <p className="max-w-md text-sm leading-relaxed text-muted">
          A passkey signs you in with your face, fingerprint or device PIN.
          There is no password to forget, and nothing to steal from us — we only
          ever hold the public half.
        </p>
      </div>

      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onAdd}
          disabled={busy}
          className="btn-go px-6 py-3 text-sm disabled:opacity-50"
        >
          {busy ? "Waiting for your device…" : "Add a passkey"}
        </button>
        <button
          type="button"
          onClick={onSkip}
          className="text-xs text-muted-dim underline underline-offset-4 transition-colors hover:text-foreground"
        >
          Later
        </button>
      </div>
    </div>
  );
}

/**
 * Time at the cube, in the largest unit that is still true.
 *
 * "94 minutes" is a worse sentence than "1h 34m" and a much worse one than
 * "2 hours" when the point is the scale of what they have done.
 */
function humaniseDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder === 0 ? `${hours}h` : `${hours}h ${remainder}m`;
}

/**
 * What it would take to see a projection. It used to subtract the total solve
 * count, which went negative the moment stopwatch or imported csTimer times
 * outnumbered the threshold — "-18 more solves" — while promising something
 * those solves can never unlock, because they were not turned here.
 */
function projectionHint(turned: number, total: number): string {
  const needed = MIN_SOLVES_TO_PROJECT - turned;
  if (turned === 0 && total > 0) {
    return "Stopwatch and imported times count as solves, but a pace on the ladder can only come from solves turned here — on the keyboard or a connected cube.";
  }
  if (needed > 0) {
    return `${needed} more solve${needed === 1 ? "" : "s"} on the keyboard or a connected cube and we can show you where that pace would sit on the ladder.`;
  }
  // Enough solves, but no average of five that finished — too many DNFs.
  return "Finish an average of five without a DNF and we can show you where that pace would sit on the ladder.";
}
