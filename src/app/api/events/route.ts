// From `analyticsEvents`, never from `analytics` — that module carries
// `"use client"`, and importing it here yields a client-reference proxy rather
// than the array. It typechecks, it resolves, and `EVENTS.includes` throws at
// runtime on every request. That is not hypothetical: it shipped, the allowlist
// never ran, and the entire measurement layer recorded nothing while every
// screen reported events. Found by looking at the table, not at the code.
import { isKnownEvent, type EventName } from "@/lib/analyticsEvents";
import { jsonError, readJson } from "@/lib/server/authRoutes";
import { currentUserId } from "@/lib/server/currentUser";
import { db, isDatabaseConfigured } from "@/lib/server/supabase";

/**
 * Where measurements land.
 *
 * This is a public, unauthenticated write path into the database, which makes
 * it the most abusable endpoint in the application. Three things keep it
 * bounded, and all three are here rather than trusted to the client:
 *
 *   1. **The event name must be on the allowlist.** Without this the table is a
 *      free-text store anybody can fill with anything.
 *   2. **Properties are capped** in count, key length and value length, and
 *      only primitives are kept. A nested object is dropped rather than stored.
 *   3. **The identifiers are length-checked**, matching the constraints on the
 *      columns, so a megabyte of "visitor id" is refused before Postgres sees
 *      it.
 *
 * No IP address is recorded. The table has no column for one — a stronger
 * guarantee than a policy, and deliberate.
 *
 * Every failure returns 204. A visitor whose measurement failed should still
 * have a working page, and telling a client that its analytics call was
 * malformed only helps somebody probing the endpoint.
 */
export const dynamic = "force-dynamic";

const MAX_PROPS = 8;
const MAX_KEY = 32;
const MAX_VALUE = 64;

/**
 * A fresh 204 per call, never a shared instance.
 *
 * A `Response` carries a body stream that can be consumed once, so a
 * module-level constant returned from many requests is a bug waiting for the
 * first version of this that has a body.
 */
const noContent = () => new Response(null, { status: 204 });

interface Body {
  name?: unknown;
  visitor?: unknown;
  session?: unknown;
  props?: unknown;
}

function cleanProps(input: unknown): Record<string, string | number | boolean> | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return null;

  const out: Record<string, string | number | boolean> = {};
  let kept = 0;
  for (const [key, value] of Object.entries(input)) {
    if (kept >= MAX_PROPS) break;
    if (key.length === 0 || key.length > MAX_KEY) continue;

    if (typeof value === "string") {
      if (value.length > MAX_VALUE) continue;
      out[key] = value;
    } else if (typeof value === "number" && Number.isFinite(value)) {
      out[key] = value;
    } else if (typeof value === "boolean") {
      out[key] = value;
    } else {
      // Anything else — objects, arrays, null, undefined — is dropped rather
      // than coerced. A property that arrives as something unexpected is not
      // one this app chose to send.
      continue;
    }
    kept++;
  }
  return kept > 0 ? out : null;
}

const isId = (value: unknown): value is string =>
  typeof value === "string" && value.length >= 8 && value.length <= 64;

export async function POST(request: Request) {
  if (!isDatabaseConfigured()) return noContent();

  const body = await readJson<Body>(request);
  if (!body) return noContent();

  // The allowlist. The client checks it too, which is a convenience; this is
  // the check that matters, because the client is whatever somebody sends.
  if (!isKnownEvent(body.name)) return noContent();
  if (!isId(body.visitor)) return noContent();
  if (body.session !== undefined && !isId(body.session)) return noContent();

  // Attached when there is a session, so an account's own funnel can be
  // followed. Never used to identify an anonymous visitor: the two ids are kept
  // apart on purpose, and nothing backfills earlier anonymous rows with an
  // account once somebody signs up.
  const userId = await currentUserId();

  await db()
    .from("events")
    .insert({
      name: body.name satisfies EventName,
      visitor: body.visitor,
      session: isId(body.session) ? body.session : null,
      user_id: userId,
      props: cleanProps(body.props),
    })
    // Discarded deliberately, and this is the one place in the codebase where
    // that is right: a failed measurement must never surface to a visitor, and
    // there is nothing for them to do about it.
    .then(() => undefined);

  return noContent();
}

export function GET() {
  // Not readable. The retention figures are computed by `npm run retention`,
  // which runs server-side with the service key — there is no reason for this
  // data to have a public read path.
  return jsonError("Not readable.", 405);
}
