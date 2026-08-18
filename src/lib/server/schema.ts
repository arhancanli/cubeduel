import "server-only";

/**
 * Telling "the migrations were not applied" apart from "the database is down".
 *
 * These need different answers and the difference matters. An outage must be
 * loud: the standing rule in this codebase is that a failed read never renders
 * as an empty state, because "Nobody is ranked yet" is indistinguishable from
 * the truth and nobody ever investigates it.
 *
 * A missing table is not an outage though — it is a setup step somebody has not
 * done yet, and it is the single most likely thing to go wrong when cloning this
 * repo, because the migrations have to be applied in order and applying only the
 * first one leaves an app that looks fine until you open the duel page.
 *
 * So this narrows exactly one error code and lets everything else through
 * untouched.
 */

/**
 * PostgREST's code for a relation it cannot find in its schema cache.
 *
 * Not Postgres's own `42P01`: the request never reaches the planner, because
 * PostgREST resolves the table against its cached schema first.
 */
const UNKNOWN_TABLE = "PGRST205";

export class MissingTableError extends Error {
  constructor(readonly table: string) {
    super(
      `The \`${table}\` table does not exist. Apply everything in supabase/migrations in filename order.`,
    );
    this.name = "MissingTableError";
  }
}

/** Narrow a Supabase error to a missing table, or return null. */
export function asMissingTable(
  error: { code?: string } | null,
  table: string,
): MissingTableError | null {
  return error?.code === UNKNOWN_TABLE ? new MissingTableError(table) : null;
}

/**
 * Runs a read, converting only "no such table" into a typed error.
 *
 * Anything else is rethrown with its message intact, so a genuine outage still
 * reaches the page as a failure rather than as a gate saying "not set up".
 */
export function raise(
  error: { code?: string; message?: string } | null,
  table: string,
  context: string,
): never {
  const missing = asMissingTable(error, table);
  if (missing) throw missing;
  throw new Error(`${context}: ${error?.message ?? "unknown error"}`);
}
