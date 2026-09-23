"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { EVENTS, EVENT_IDS, type EventId } from "@/lib/events";

/** Starting a race: pick the puzzle, get a link. */

const CREATE = "/api/race/create";

export function RaceStart({ signedIn }: { signedIn: boolean }) {
  const router = useRouter();
  const [event, setEvent] = useState<EventId>("333");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!signedIn) {
    return (
      <p className="max-w-md text-center text-sm leading-relaxed text-muted">
        <Link href="/join?next=/race" className="text-foreground underline underline-offset-4">
          Create an account
        </Link>{" "}
        or{" "}
        <Link href="/sign-in?next=/race" className="text-foreground underline underline-offset-4">
          sign in
        </Link>{" "}
        to start a race. The person you send it to will need one too — a result has to belong to somebody.
      </p>
    );
  }

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(CREATE, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ event }),
      });
      const body = (await response.json().catch(() => null)) as { code?: string; error?: string } | null;
      if (!response.ok || !body?.code) {
        setError(body?.error ?? "Could not create the race.");
        setBusy(false);
        return;
      }
      router.push(`/race/${body.code}`);
    } catch {
      setError("Could not reach the server.");
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="flex flex-wrap justify-center gap-2" role="radiogroup" aria-label="Puzzle">
        {EVENT_IDS.map((id) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={event === id}
            onClick={() => setEvent(id)}
            className={`rounded-lg border px-4 py-2 text-sm transition-colors ${
              event === id ? "border-foreground text-foreground" : "border-border text-muted hover:border-muted-dim"
            }`}
          >
            {EVENTS[id].name}
          </button>
        ))}
      </div>
      <button
        type="button"
        disabled={busy}
        onClick={() => void create()}
        data-testid="race-create"
        className="btn-go px-7 py-3 text-sm disabled:opacity-50"
      >
        {busy ? "Creating…" : "Create a race"}
      </button>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
