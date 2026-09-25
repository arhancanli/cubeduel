"use client";

import Link from "next/link";
import { useState } from "react";

/**
 * Follow and unfollow, with the counts beside it. The count shown after a tap
 * is the one the server sends back, never one worked out here — two tabs, or
 * somebody else following at the same moment, would make a local guess wrong.
 */
export function FollowButton({
  handle,
  signedIn,
  initiallyFollowing,
  initialFollowers,
  following,
}: {
  handle: string;
  signedIn: boolean;
  initiallyFollowing: boolean;
  initialFollowers: number;
  following: number;
}) {
  const [isFollowing, setIsFollowing] = useState(initiallyFollowing);
  const [followers, setFollowers] = useState(initialFollowers);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/follow", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ handle, follow: !isFollowing }),
      });
      const data = (await response.json().catch(() => null)) as
        | { following?: boolean; followers?: number; error?: string }
        | null;
      if (!response.ok || typeof data?.following !== "boolean") {
        setError(data?.error ?? "That didn't go through. Try again.");
        return;
      }
      setIsFollowing(data.following);
      if (typeof data.followers === "number") setFollowers(data.followers);
    } catch {
      setError("You're offline. Try again when you're connected.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2" data-testid="follow">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {signedIn ? (
          <button
            type="button"
            onClick={toggle}
            disabled={busy}
            aria-pressed={isFollowing}
            className={`${isFollowing ? "btn-secondary" : "btn-go"} px-4 py-2 text-sm disabled:opacity-60`}
          >
            {isFollowing ? "Following" : "Follow"}
          </button>
        ) : (
          <Link href={`/sign-in?next=/u/${handle}`} className="btn-go px-4 py-2 text-sm">
            Follow
          </Link>
        )}
        <p className="text-sm text-muted">
          <span className="tnum font-semibold text-foreground" data-testid="followers">{followers}</span>{" "}
          follower{followers === 1 ? "" : "s"}
          <span className="mx-2 text-muted-dim">·</span>
          <span className="tnum font-semibold text-foreground">{following}</span> following
        </p>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
