-- Pin the search path of the one function this schema defines.
--
-- Supabase's security advisor reports `function_search_path_mutable` for
-- `apply_rating_window`: without a fixed search_path, the tables the function
-- names are resolved through whatever search_path the calling session has, so a
-- caller able to create objects earlier on that path could put its own
-- `ratings` in front of the real one.
--
-- Nobody can exploit it today — EXECUTE is revoked from everybody but
-- service_role (0001), and the function runs with its caller's rights rather
-- than its owner's — but both of those are properties somebody could change
-- later for a good-sounding reason, and this is the fix that does not depend on
-- either of them staying true. `pg_temp` goes last, as Postgres recommends, so
-- temporary tables can never shadow the real ones either.

alter function apply_rating_window(
  uuid, text, text, integer, real, real, real, real, integer, real, timestamptz, uuid[]
) set search_path = public, pg_temp;
