import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "./database.types";

/**
 * The only database handle in the app, and it holds the service-role key.
 *
 * Every table has RLS enabled with no policies, which denies the anon and
 * authenticated roles outright. Nothing reaches Postgres except through this
 * client, which means every read and write passes through server code that has
 * already checked the session cookie and, for anything ranked, re-verified the
 * result itself.
 *
 * That is a deliberate trade. Handing the browser a scoped key and writing RLS
 * policies is less code, but it puts the client on the write path for ratings and
 * leaderboards — and a rating the client can influence is not a rating. The
 * `server-only` import above is what enforces this: importing this module from a
 * client component fails the build rather than shipping the key to a browser.
 */

let cached: SupabaseClient<Database> | null = null;

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    // Thrown at call time rather than import time so a missing variable breaks
    // the one request that needed the database, not the whole build.
    throw new Error(
      `${name} is not set. The database-backed routes cannot run without it.`,
    );
  }
  return value;
}

export function db(): SupabaseClient<Database> {
  cached ??= createClient<Database>(
    required("NEXT_PUBLIC_SUPABASE_URL"),
    required("SUPABASE_SECRET_KEY"),
    {
      auth: {
        // There is no Supabase user session here — identity is this
        // application's own `sessions` table, and this client is a trusted
        // server actor. Persisting or refreshing a session would be meaningless
        // and, in a serverless function, leaky.
        persistSession: false,
        autoRefreshToken: false,
      },
    },
  );
  return cached;
}

/** True when the database is configured at all, for degrading gracefully. */
export function isDatabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SECRET_KEY,
  );
}
