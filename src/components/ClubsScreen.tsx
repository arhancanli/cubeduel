"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Reveal } from "@/components/Reveal";
import { SiteHeader } from "@/components/SiteHeader";
import { MAX_CLUBS_PER_PERSON, slugFromName } from "@/lib/club";

/**
 * Where somebody joins a club, or starts one.
 *
 * Joining comes first and is one field. That ordering is the whole point: the
 * overwhelmingly common arrival here is somebody who was handed a code in a
 * group chat, and putting a creation form above them would ask the wrong
 * question of almost everybody.
 *
 * The address is derived from the name as it is typed, and shown rather than
 * asked for. Somebody naming their school's cubing club should not also have to
 * invent a URL for it — but they should be able to see and change what they are
 * about to be given, because it is permanent and public.
 */

export interface ClubSummary {
  id: string;
  slug: string;
  name: string;
  memberCount: number;
  role: "owner" | "member";
  joinCode: string;
}

export function ClubsScreen({
  clubs,
  signedIn,
  initialCode = "",
}: {
  clubs: ClubSummary[];
  signedIn: boolean;
  /** From `/clubs?code=…`: an invite link, or the form's own no-script fallback. */
  initialCode?: string;
}) {
  const router = useRouter();

  const [code, setCode] = useState(initialCode);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [busy, setBusy] = useState<"join" | "create" | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Derived as they type, until they edit it themselves — at which point it is
  // theirs and must stop moving under them.
  const suggested = slugTouched ? slug : (slugFromName(name) ?? "");

  async function join(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submitted = String(new FormData(event.currentTarget).get("code") ?? "").trim();
    if (!submitted) return;

    setBusy("join");
    setError(null);
    const response = await fetch("/api/clubs/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: submitted }),
    });
    setBusy(null);

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? "Could not join.");
      return;
    }
    const body = (await response.json()) as { slug: string };
    router.push(`/c/${body.slug}`);
  }

  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const submittedName = String(form.get("name") ?? "").trim();
    const submittedSlug = String(form.get("slug") ?? "").trim().toLowerCase();
    if (!submittedName || !submittedSlug) return;

    setBusy("create");
    setError(null);
    const response = await fetch("/api/clubs/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: submittedName, slug: submittedSlug }),
    });
    setBusy(null);

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? "Could not create that club.");
      return;
    }
    const body = (await response.json()) as { slug: string };
    router.push(`/c/${body.slug}`);
  }

  return (
    <main className="flex min-h-dvh flex-col">
      <SiteHeader active="clubs" />

      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-10 px-6 pb-24 pt-8">
        <Reveal className="flex flex-col gap-3">
          <h1 className="text-3xl font-medium leading-tight tracking-tight">Clubs</h1>
          <p className="max-w-lg text-sm leading-relaxed text-muted">
            A board for the people you actually cube with — your school, your
            university, your group chat. Ranked by the same verified solves as
            the global ladder, because a private board with friendlier numbers
            would not be worth looking at.
          </p>
        </Reveal>

        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}

        {clubs.length > 0 ? (
          <Reveal className="flex flex-col gap-3">
            <h2 className="text-[10px] uppercase tracking-widest text-muted-dim">
              Your clubs
            </h2>
            <ul className="flex list-none flex-col gap-px overflow-hidden rounded-xl border border-border bg-border p-0">
              {clubs.map((club) => (
                <li key={club.id} className="flex items-center gap-4 bg-surface px-4 py-3">
                  <Link href={`/c/${club.slug}`} className="min-w-0 flex-1 truncate text-sm">
                    {club.name}
                    {club.role === "owner" ? (
                      <span className="ml-2 text-xs text-muted-dim">owner</span>
                    ) : null}
                  </Link>
                  <span className="shrink-0 font-mono text-xs tabular-nums text-muted-dim">
                    {club.memberCount}
                  </span>
                </li>
              ))}
            </ul>
          </Reveal>
        ) : null}

        {!signedIn ? (
          <Reveal className="rounded-xl border border-border bg-surface px-5 py-4">
            <p className="text-sm text-muted">
              Clubs need an account, because a rating has to belong to somebody.{" "}
              <Link href="/join" className="text-foreground underline underline-offset-4">
                Make one
              </Link>{" "}
              — it takes a moment and keeps the solves you have already done.
            </p>
          </Reveal>
        ) : (
          <>
            {/* Joining first: almost everybody arriving here was handed a code. */}
            <Reveal className="flex flex-col gap-3">
              <h2 className="text-[10px] uppercase tracking-widest text-muted-dim">
                Join with a code
              </h2>
              <form onSubmit={join} className="flex flex-wrap items-start gap-3">
                <input
                  id="code"
                  name="code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="abcd2345"
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  aria-label="Club invite code"
                  className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-4 py-3 font-mono text-sm tracking-[0.15em] outline-none transition-colors placeholder:tracking-normal placeholder:text-muted-dim focus-visible:border-muted-dim"
                />
                <button
                  type="submit"
                  disabled={busy !== null}
                  className="rounded-lg bg-foreground px-6 py-3 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  {busy === "join" ? "Joining…" : "Join"}
                </button>
              </form>
              <p className="text-xs leading-relaxed text-muted-dim">
                Paste the code or the whole invite link — either works.
              </p>
            </Reveal>

            <Reveal className="flex flex-col gap-3">
              <h2 className="text-[10px] uppercase tracking-widest text-muted-dim">
                Or start one
              </h2>
              <form onSubmit={create} className="flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <label htmlFor="club-name" className="text-sm font-medium">
                    Club name
                  </label>
                  <input
                    id="club-name"
                    name="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="King's Cubing Club"
                    maxLength={60}
                    className="w-full rounded-lg border border-border bg-surface px-4 py-3 text-sm outline-none transition-colors placeholder:text-muted-dim focus-visible:border-muted-dim"
                  />
                </div>

                <div className="flex flex-col gap-2">
                  <label htmlFor="club-slug" className="text-sm font-medium">
                    Address
                  </label>
                  <div className="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-4 py-3 focus-within:border-muted-dim">
                    <span className="shrink-0 font-mono text-sm text-muted-dim">/c/</span>
                    <input
                      id="club-slug"
                      name="slug"
                      value={suggested}
                      onChange={(e) => {
                        setSlugTouched(true);
                        setSlug(e.target.value.toLowerCase());
                      }}
                      placeholder="kings-cubing"
                      maxLength={32}
                      autoCapitalize="none"
                      spellCheck={false}
                      className="min-w-0 flex-1 bg-transparent font-mono text-sm outline-none placeholder:text-muted-dim"
                    />
                  </div>
                  <p className="text-xs leading-relaxed text-muted-dim">
                    This is the link you will share, and it is permanent. Suggested
                    from the name — change it if you want something shorter.
                  </p>
                </div>

                <button
                  type="submit"
                  disabled={busy !== null}
                  className="self-start rounded-lg border border-border px-6 py-3 text-sm font-medium transition-colors hover:border-muted-dim disabled:opacity-50"
                >
                  {busy === "create" ? "Creating…" : "Create club"}
                </button>
                <p className="text-xs text-muted-dim">
                  You can start up to {MAX_CLUBS_PER_PERSON}.
                </p>
              </form>
            </Reveal>
          </>
        )}
      </div>
    </main>
  );
}
