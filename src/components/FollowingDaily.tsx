"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { formatMs } from "@/lib/format";

interface Row {
  handle: string;
  displayName: string;
  durationMs: number;
  penalty: string;
  verified: boolean;
  isYou: boolean;
}

/**
 * Today's scramble, you and the people you follow — the point of a daily is
 * having done the same cube as somebody you know. Shown only to someone signed
 * in who follows anybody; for everyone else it is not there at all, rather
 * than a panel asking them to do something first.
 *
 * `refresh` changes when your own result has reached the server, so the list
 * is read again with you in it.
 */
export function FollowingDaily({ refresh }: { refresh: number }) {
  const [state, setState] = useState<{ results: Row[]; following: number } | null>(null);

  useEffect(() => {
    let live = true;
    fetch("/api/daily/following")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { results?: Row[]; following?: number } | null) => {
        if (live && data && Array.isArray(data.results) && typeof data.following === "number") {
          setState({ results: data.results, following: data.following });
        }
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [refresh]);

  if (!state || state.following === 0) return null;
  const others = state.results.filter((r) => !r.isYou).length;

  return (
    <section data-testid="following-daily" className="w-full max-w-sm text-left">
      <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-dim">People you follow, today</h2>
      {others === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-3 text-sm text-muted">
          Nobody you follow has played today&apos;s yet. You&apos;re first.
        </p>
      ) : (
        <ol className="divide-y divide-border overflow-hidden rounded-xl border border-border">
          {state.results.map((row, i) => (
            <li
              key={row.handle}
              data-you={row.isYou || undefined}
              className={`flex items-center gap-3 px-4 py-2.5 text-sm ${row.isYou ? "bg-surface-hi" : "bg-surface"}`}
            >
              <span className="tnum w-5 shrink-0 text-muted-dim">{i + 1}</span>
              <Link href={`/u/${row.handle}`} className="min-w-0 flex-1 truncate hover:underline">
                {row.isYou ? "You" : row.displayName}
              </Link>
              {row.verified ? null : <span className="text-[11px] text-muted-dim">self-timed</span>}
              <span className="tnum shrink-0 font-semibold">
                {row.penalty === "DNF" ? "DNF" : formatMs(row.durationMs + (row.penalty === "PLUS2" ? 2000 : 0))}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
