import { redirect } from "next/navigation";

import { isDatabaseConfigured } from "@/lib/server/supabase";
import { completeWcaLink, wcaConfigured } from "@/lib/server/wca";

/**
 * Where the WCA sends somebody back.
 *
 * Always ends in a redirect to settings, with the outcome in the query rather
 * than as a status code — this is a browser navigation, and a person arriving
 * back from another site should land on a page, never on JSON.
 *
 * The identity is taken from the WCA using the token this exchanges for, never
 * from anything in this URL. That is the whole point: the WCA is telling us who
 * this is, rather than the browser claiming it.
 */
export const dynamic = "force-dynamic";

function back(outcome: string): never {
  redirect(`/settings?wca=${encodeURIComponent(outcome)}`);
}

export async function GET(request: Request) {
  if (!isDatabaseConfigured() || !wcaConfigured()) back("unavailable");

  const url = new URL(request.url);

  // The WCA sends `error=access_denied` when somebody declines. That is a
  // decision, not a failure, and should not be reported as one.
  if (url.searchParams.get("error")) back("cancelled");

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) back("invalid");

  const result = await completeWcaLink(code, state);
  back(result.ok ? "linked" : "failed");
}
