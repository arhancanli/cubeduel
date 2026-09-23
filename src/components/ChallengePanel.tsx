"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
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
  event: string;
  them: { handle: string; displayName: string | null };
  status: "pending" | "complete" | "expired" | "declined";
  createdAt: string;
  expiresAt: string;
  own: Side;
  theirs: Side | null;
  awaitingYou: boolean;
  outcome: "win" | "loss" | "draw" | null;
  /** Yours, still on the board, waiting for anybody to take it. */
  open: boolean;
}

/** Somebody else's offer, as the board shows it. */
export interface OpenChallengeItem {
  id: string;
  event: string;
  createdAt: string;
  expiresAt: string;
  by: { handle: string; displayName: string | null };
  authorSolved: boolean;
}

export function ChallengePanel({
  initial,
  initialOpen = [],
}: {
  initial: ChallengeItem[];
  initialOpen?: OpenChallengeItem[];
}) {
  const router = useRouter();
  const [items, setItems] = useState(initial);
  const [board, setBoard] = useState(initialOpen);
  const [handle, setHandle] = useState("");
  const [sending, setSending] = useState(false);
  const [posting, setPosting] = useState(false);
  const [taking, setTaking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  // An offer nobody has taken is not "your turn": there is no opponent to keep
  // waiting, and it was showing up in that list with an empty name where a
  // handle should be. It gets its own section, and its author may still open
  // their own attempt whenever they like.
  const waiting = items.filter((c) => c.awaitingYou && !c.open);
  const onBoard = items.filter((c) => c.status === "pending" && c.open);
  const pending = items.filter((c) => c.status === "pending" && !c.open && !c.awaitingYou);
  const settled = items.filter((c) => c.status !== "pending").slice(0, 6);

  async function refresh() {
    // Both lists, because taking a challenge moves a row from one to the other.
    const [mine, open] = await Promise.all([
      fetch("/api/challenge/list").then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch("/api/challenge/open").then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]);
    if (mine?.challenges) setItems(mine.challenges as ChallengeItem[]);
    if (open?.open) setBoard(open.open as OpenChallengeItem[]);
  }

  async function leaveOpen() {
    setPosting(true);
    setError(null);
    setSent(null);
    try {
      const response = await fetch("/api/challenge/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ open: true }),
      });
      const body = (await response.json().catch(() => null)) as
        | { challengeId?: string; error?: string }
        | null;
      if (!response.ok || !body?.challengeId) {
        setError(body?.error ?? "Could not leave that challenge.");
        return;
      }
      await refresh();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setPosting(false);
    }
  }

  async function take(id: string) {
    setTaking(id);
    setError(null);
    try {
      const response = await fetch("/api/challenge/accept", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const body = (await response.json().catch(() => null)) as
        | { challengeId?: string; error?: string }
        | null;

      if (!response.ok || !body?.challengeId) {
        // Somebody getting there first is the ordinary case on a board, not an
        // error to apologise for — so the reason is shown and the row goes.
        setError(body?.error ?? "Could not take that challenge.");
        await refresh();
        return;
      }
      // Taking a seat and then opening the attempt are two separate moments,
      // and this is only the first: the challenge page is where the cube
      // appears, after you say you are ready.
      router.push(`/challenge/${body.challengeId}`);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setTaking(null);
    }
  }

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
        <h2 className="text-sm tracking-tight">Challenge a player</h2>
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
          className="btn-go px-4 py-2 text-sm disabled:opacity-40"
        >
          {sending ? "Sending…" : "Challenge"}
        </button>
      </form>

      <p className="mt-2 text-xs leading-relaxed text-muted-dim">
        You both solve the same scramble, whenever suits you. Neither of you sees
        it until you open your own attempt, and neither time is shown until you
        have both finished. Two days to answer, then it goes to whoever turned up.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <button
          type="button"
          onClick={leaveOpen}
          disabled={posting}
          data-testid="challenge-open"
          className="rounded-lg border border-border px-3 py-1.5 text-xs text-foreground transition-colors hover:border-muted-dim disabled:opacity-40"
        >
          {posting ? "Leaving…" : "Leave one open to anybody"}
        </button>
        <span className="text-xs text-muted-dim">
          Nobody to challenge yet? Leave it on the board and whoever turns up next takes it.
        </span>
      </div>

      {error ? <p className="mt-3 text-xs text-danger">{error}</p> : null}
      {sent ? (
        <p className="mt-3 text-xs text-ready">Challenge sent to {sent}.</p>
      ) : null}

      {board.length > 0 ? (
        <div className="mt-6">
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-dim">
            Open to anybody
          </h3>
          <ul className="flex flex-col gap-2" data-testid="open-board">
            {board.map((c) => (
              <li
                key={c.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-border px-4 py-3"
              >
                <span className="min-w-0 text-sm">
                  <span className="font-mono">{c.by.handle}</span>
                  <span className="text-muted-dim">
                    {" · "}
                    {c.event}
                    {c.authorSolved ? " · they have solved" : ""}
                  </span>
                </span>
                <span className="flex flex-none items-center gap-3">
                  <span className="text-xs text-muted-dim">{remaining(c.expiresAt)}</span>
                  <button
                    type="button"
                    onClick={() => take(c.id)}
                    disabled={taking !== null}
                    className="btn-go px-3 py-1.5 text-xs disabled:opacity-40"
                  >
                    {taking === c.id ? "Taking…" : "Take it"}
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {onBoard.length > 0 ? (
        <div className="mt-6">
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-dim">
            Yours, on the board
          </h3>
          <ul className="flex flex-col gap-2">
            {onBoard.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/challenge/${c.id}`}
                  className="flex items-center justify-between rounded-lg border border-border px-4 py-3 text-sm transition-colors hover:border-muted-dim"
                >
                  <span className="text-muted">
                    waiting for anybody · {c.event}
                    {c.awaitingYou ? " · solve your half whenever" : " · you have solved"}
                  </span>
                  <span className="text-xs text-muted-dim">{remaining(c.expiresAt)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {waiting.length > 0 ? (
        <div className="mt-6">
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-dim">
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
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-dim">
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
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-dim">
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
