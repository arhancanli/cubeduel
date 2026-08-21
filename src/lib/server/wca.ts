import "server-only";

import { hashTokenForPostgrest, newToken } from "../auth/tokens";
import { SITE_URL } from "../site";
import {
  isValidWcaId,
  parseWcaPerson,
  type WcaProfile,
  type WcaRecord,
} from "../wca";
import { db } from "./supabase";

/**
 * Linking a WCA account, and reading what it says.
 *
 * Two rules govern everything here.
 *
 * **A link is proved, never claimed.** There is no way to type in a WCA id. Every
 * WCA id is public — they are all on worldcubeassociation.org — so a text field
 * would let anybody attach a world-class competition average to their profile,
 * and the number beside their name would be a lie that looks exactly like the
 * truth. The only route in is the WCA's own OAuth.
 *
 * **Nothing read from the WCA ever becomes a rating.** The records are cached
 * for display and nothing else: no write to `ratings`, no leaderboard entry, no
 * effect on anything ranked. A rating on this ladder is earned by solves this
 * server issued a scramble for and replayed, and a result from somebody else's
 * competition is not that, however true it is.
 */

const WCA_ORIGIN = "https://www.worldcubeassociation.org";
const STATE_TTL_MS = 10 * 60 * 1000;

/**
 * How long cached records are kept before a refresh is worth making.
 *
 * A day. WCA results change when somebody competes, which for almost everybody
 * is a handful of times a year — so anything shorter is a third-party request
 * made on a page view for data that has not moved.
 */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/** Whether the deployment can offer this at all. */
export function wcaConfigured(): boolean {
  return Boolean(process.env.WCA_CLIENT_ID && process.env.WCA_CLIENT_SECRET);
}

function redirectUri(): string {
  return `${SITE_URL}/api/wca/callback`;
}

export interface WcaLink {
  wcaId: string;
  name: string | null;
  country: string | null;
  competitions: number | null;
  records: Partial<Record<string, WcaRecord>>;
  verifiedAt: string;
  refreshedAt: string | null;
}

// ---------------------------------------------------------------------------
// Starting the flow
// ---------------------------------------------------------------------------

/**
 * Begins an OAuth flow and returns where to send the browser.
 *
 * The `state` is generated here and its hash stored against the profile that
 * started it, rather than being a value the callback simply echoes back. That
 * is not ceremony: without a server-side record, an attacker can start a flow
 * with their own WCA account and hand the finished callback URL to somebody
 * else, who silently ends up with the attacker's competition results attached
 * to their profile.
 */
export async function beginWcaLink(profileId: string): Promise<string | null> {
  if (!wcaConfigured()) return null;

  const state = newToken();
  const { error } = await db().from("wca_oauth_states").insert({
    state_hash: hashTokenForPostgrest(state),
    profile_id: profileId,
    expires_at: new Date(Date.now() + STATE_TTL_MS).toISOString(),
  });

  // Checked rather than discarded: a state we failed to store is one the
  // callback will refuse, and sending somebody to the WCA to be turned away on
  // return is worse than saying no now.
  if (error) return null;

  const params = new URLSearchParams({
    client_id: process.env.WCA_CLIENT_ID as string,
    redirect_uri: redirectUri(),
    response_type: "code",
    // The narrowest scope that answers "who is this". It does not permit
    // registering for competitions or reading anything private, and asking for
    // more than the question needs is how a permission prompt becomes alarming.
    scope: "public",
    state,
  });

  return `${WCA_ORIGIN}/oauth/authorize?${params.toString()}`;
}

/**
 * Redeems the state exactly once, and says whose flow it was.
 *
 * `DELETE ... RETURNING`, so two requests racing the same callback cannot both
 * succeed — the same reasoning as the WebAuthn challenges.
 */
async function consumeState(state: string): Promise<string | null> {
  if (!state) return null;

  const { data, error } = await db()
    .from("wca_oauth_states")
    .delete()
    .eq("state_hash", hashTokenForPostgrest(state))
    .select("profile_id, expires_at")
    .maybeSingle();

  if (error || !data) return null;
  if (Date.now() >= new Date(data.expires_at).getTime()) return null;
  return data.profile_id;
}

// ---------------------------------------------------------------------------
// Finishing it
// ---------------------------------------------------------------------------

export type LinkOutcome =
  | { ok: true; wcaId: string }
  | { ok: false; error: string };

/**
 * Exchanges the code, asks the WCA who it belongs to, and stores the link.
 *
 * The identity comes from `/api/v0/me` with the freshly issued token — never
 * from anything in the callback URL. That is the entire point of the exercise:
 * the WCA is telling us who this is, rather than the browser claiming it.
 */
export async function completeWcaLink(
  code: string,
  state: string,
): Promise<LinkOutcome> {
  if (!wcaConfigured()) return { ok: false, error: "WCA linking is not configured." };

  const profileId = await consumeState(state);
  if (!profileId) return { ok: false, error: "That link request expired. Try again." };

  let accessToken: string;
  try {
    const response = await fetch(`${WCA_ORIGIN}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "authorization_code",
        client_id: process.env.WCA_CLIENT_ID,
        client_secret: process.env.WCA_CLIENT_SECRET,
        redirect_uri: redirectUri(),
        code,
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) return { ok: false, error: "The WCA refused that request." };
    const body = (await response.json()) as { access_token?: unknown };
    if (typeof body.access_token !== "string") {
      return { ok: false, error: "The WCA sent something unexpected." };
    }
    accessToken = body.access_token;
  } catch {
    return { ok: false, error: "Could not reach the WCA. Try again." };
  }

  let wcaId: string;
  try {
    const response = await fetch(`${WCA_ORIGIN}/api/v0/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return { ok: false, error: "Could not read your WCA profile." };

    const body = (await response.json()) as { me?: { wca_id?: unknown } };
    const id = body.me?.wca_id;

    // Somebody can have a WCA account without ever having competed, and so
    // without an id. That is not an error and not their fault — there is simply
    // nothing to link yet.
    if (typeof id !== "string" || !isValidWcaId(id)) {
      return {
        ok: false,
        error: "That WCA account has no competition results yet, so there is nothing to link.",
      };
    }
    wcaId = id.toUpperCase();
  } catch {
    return { ok: false, error: "Could not reach the WCA. Try again." };
  }

  const { error } = await db()
    .from("wca_links")
    .upsert(
      { profile_id: profileId, wca_id: wcaId, verified_at: new Date().toISOString() },
      { onConflict: "profile_id" },
    );

  if (error) {
    // The unique index on `wca_id` fires when another account has already
    // proved this competitor. Both cannot be them, and the one who proved it
    // first keeps it — re-linking would silently move a competition record from
    // one profile to another.
    if (error.code === "23505") {
      return { ok: false, error: "That WCA profile is already linked to another account." };
    }
    return { ok: false, error: "Could not save that link. Try again." };
  }

  // Fetched now so the profile has something to show immediately. A failure
  // here leaves the link in place with no records, which is a page that fills
  // in a moment rather than a link that did not work.
  await refreshRecords(profileId, wcaId);

  return { ok: true, wcaId };
}

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

/** Fetches a competitor's public results. Null on any failure. */
export async function fetchWcaProfile(wcaId: string): Promise<WcaProfile | null> {
  if (!isValidWcaId(wcaId)) return null;

  try {
    const response = await fetch(`${WCA_ORIGIN}/api/v0/persons/${wcaId}`, {
      headers: {
        // Named, because a request from a real product to a volunteer-run
        // service should say who it is.
        "User-Agent": "cubeduel (+https://github.com/arhancanli/cubeduel)",
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return null;
    return parseWcaPerson(await response.json());
  } catch {
    return null;
  }
}

async function refreshRecords(profileId: string, wcaId: string): Promise<void> {
  const profile = await fetchWcaProfile(wcaId);
  if (!profile) return;

  await db()
    .from("wca_links")
    .update({
      name: profile.name,
      country: profile.country,
      competitions: profile.competitionCount,
      records: profile.records as never,
      refreshed_at: new Date().toISOString(),
    })
    .eq("profile_id", profileId);
}

/**
 * The link for a profile, refreshing the cache when it has gone stale.
 *
 * The refresh is not awaited. A page that waited on a third party would be a
 * page whose speed depends on somebody else's uptime, and the data it is
 * waiting for changes a few times a year.
 */
export async function linkFor(profileId: string): Promise<WcaLink | null> {
  const { data, error } = await db()
    .from("wca_links")
    .select("wca_id, name, country, competitions, records, verified_at, refreshed_at")
    .eq("profile_id", profileId)
    .maybeSingle();

  if (error || !data) return null;

  const stale =
    !data.refreshed_at ||
    Date.now() - new Date(data.refreshed_at).getTime() > CACHE_TTL_MS;

  if (stale) {
    void refreshRecords(profileId, data.wca_id).catch(() => {});
  }

  return {
    wcaId: data.wca_id,
    name: data.name,
    country: data.country,
    competitions: data.competitions,
    records: (data.records ?? {}) as Partial<Record<string, WcaRecord>>,
    verifiedAt: data.verified_at,
    refreshedAt: data.refreshed_at,
  };
}

export async function unlinkWca(profileId: string): Promise<boolean> {
  const { error } = await db().from("wca_links").delete().eq("profile_id", profileId);
  return !error;
}

/** Removes OAuth states that can no longer be redeemed. */
export async function sweepWcaStates(): Promise<number> {
  const { count, error } = await db()
    .from("wca_oauth_states")
    .delete({ count: "exact" })
    .lte("expires_at", new Date().toISOString());
  if (error) return 0;
  return count ?? 0;
}
