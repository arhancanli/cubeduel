"use client";

import Link from "next/link";
import { useState } from "react";

import type { Side } from "@/lib/challenge";
import { formatMs } from "@/lib/format";

/**
 * Challenges, above the bots on the duel page.
 *
 * Order is the argument: racing a person is the better game, and the bots are
 * what is always available when nobody has answered yet. Putting the bots first
 * would say the opposite.
 *
 * Rendered from data the server already redacted — an unopened scramble and an
 * unsettled opponent time never arrive here at all — so this file can render
 * everything it is given without keeping a second copy of the rules.
 */

export interface ChallengeItem {
  id: string;
  seat: "challenger" | "opponent";
  them: { handle: string; displayName: string | null };
  status: "pending" | "complete" | "expired" | "declined";
  createdAt: string;
  expiresAt: string;
  own: Side;
  theirs: Side | null;
  awaitingYou: boolean;
  outcome: "win" | "loss" | "draw" | null;
}

export function ChallengePanel({ initial }: { initial: ChallengeItem[] }) {
  const [items, setItems] = useState(initial);
  const [handle, setHandle] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  const waiting = items.filter((c) => c.awaitingYou);
  const pending = items.filter((c) => c.status === "pending" && !c.awaitingYou);
  const settled = items.filter((c) => c.status !== "pending").slice(0, 6);

  async function send(event: React.FormEvent) {
    event.preventDefault();
    const target = handle.trim().replace(/^@/, "");
    if (!target) return;

    setSending(true);
    setError(null);
    setSent(null);

    try {
      const response = await fetch("/api/challenge/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ handle: target }),
      });
      const body = (await response.json().catch(() => null)) as
        | { challengeId?: string; error?: string }
        | null;

      if (!response.ok || !body?.challengeId) {
        setError(body?.error ?? "Could not send that challenge.");
        return;
      }

      setSent(target);
      setHandle("");

      // Refetched rather than patched in locally: the row the server created is
      // the truth, and a hand-built optimistic copy is where the two versions
      // start to disagree.
      const refreshed = await fetch("/api/challenge/list");
      if (refreshed.ok) {
        const data = (await refreshed.json()) as { challenges?: ChallengeItem[] };
        if (data.challenges) setItems(data.challenges);
      }
    } catch {
      setError("Could not reach the server.");
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="w-full max-w-2xl">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-sm font-medium tracking-tight">Challenge a player</h2>
        {waiting.length > 0 ? (
          <span className="text-xs text-ready">
            {waiting.length} waiting on you
          </span>
        ) : null}
      </div>

      <form onSubmit={send} className="flex gap-2">
        <label htmlFor="challenge-handle" className="sr-only">
          Player handle
        </label>
        <input
          id="challenge-handle"
          value={handle}
          onChange={(e) => setHandle(e.target.value)}
          placeholder="their handle"
          autoComplete="off"
          spellCheck={false}
          className="min-w-0 flex-1 rounded-lg border border-border bg-transparent px-3 py-2 font-mono text-sm text-foreground placeholder:text-muted-dim focus:border-muted-dim focus:outline-none"
        />
        <button
          type="submit"
          disabled={sending || handle.trim().length === 0}
          className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {sending ? "Sending…" : "Challenge"}
        </button>
      </form>

      <p className="mt-2 text-xs leading-relaxed text-muted-dim">
        You both solve the same scramble, whenever suits you. Neither of you sees
        it until you open your own attempt, and neither time is shown until you
        have both finished. Two days to answer, then it goes to whoever turned up.
      </p>

      {error ? <p className="mt-3 text-xs text-danger">{error}</p> : null}
      {sent ? (
        <p className="mt-3 text-xs text-ready">Challenge sent to {sent}.</p>
      ) : null}

      {waiting.length > 0 ? (
        <div className="mt-6">
          <h3 className="mb-2 text-[10px] uppercase tracking-widest text-muted-dim">
            Your turn
          </h3>
          <ul className="flex flex-col gap-2">
            {waiting.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/challenge/${c.id}`}
                  className="flex items-center justify-between rounded-lg border border-ready/40 bg-ready/5 px-4 py-3 transition-colors hover:border-ready"
                >
                  <span className="text-sm">
                    {c.seat === "opponent" ? "From" : "Against"}{" "}
                    <span className="font-mono">{c.them.handle}</span>
                  </span>
                  <span className="text-xs text-muted-dim">{remaining(c.expiresAt)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {pending.length > 0 ? (
        <div className="mt-6">
          <h3 className="mb-2 text-[10px] uppercase tracking-widest text-muted-dim">
            Waiting on them
          </h3>
          <ul className="flex flex-col gap-2">
            {pending.map((c) => (
              <li
                key={c.id}
                className="flex items-center justify-between rounded-lg border border-border px-4 py-3"
              >
                <span className="text-sm">
                  <span className="font-mono">{c.them.handle}</span>
                </span>
                <span className="text-xs text-muted-dim">
                  {/* Their time is not here to show, and neither is a placeholder
                      that would imply one. */}
                  you solved · {remaining(c.expiresAt)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {settled.length > 0 ? (
        <div className="mt-6">
          <h3 className="mb-2 text-[10px] uppercase tracking-widest text-muted-dim">
            Finished
          </h3>
          <ul className="flex flex-col gap-2">
            {settled.map((c) => (
              <li
                key={c.id}
                className="flex items-center justify-between rounded-lg border border-border px-4 py-3 text-sm"
              >
                <span className="font-mono">{c.them.handle}</span>
                <span className="flex items-center gap-3">
                  <span className="tnum text-xs text-muted-dim">
                    {describe(c.own)} v {c.theirs ? describe(c.theirs) : "—"}
                  </span>
                  <span
                    className={
                      c.outcome === "win"
                        ? "text-xs text-ready"
                        : c.outcome === "loss"
                          ? "text-xs text-danger"
                          : "text-xs text-muted-dim"
                    }
                  >
                    {c.outcome === "win"
                      ? "won"
                      : c.outcome === "loss"
                        ? "lost"
                        : c.outcome === "draw"
                          ? "drew"
                          : "expired"}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function describe(side: Side): string {
  if (side.penalty === "DNF") return "DNF";
  if (side.durationMs === null) return "—";
  const base = formatMs(side.durationMs);
  return side.penalty === "PLUS2" ? `${base} (+2)` : base;
}

/** Coarse on purpose: an exact countdown on a two-day deadline is false urgency. */
function remaining(expiresAt: string): string {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return "expired";
  const hours = Math.floor(ms / 3_600_000);
  if (hours >= 24) return `${Math.floor(hours / 24)}d left`;
  if (hours >= 1) return `${hours}h left`;
  return `${Math.max(1, Math.floor(ms / 60_000))}m left`;
}
