-- cubeduel — complete schema.
--
-- Run this once against a fresh Supabase project (SQL Editor, or `supabase db
-- push`). It is the consolidated form of the three migrations the schema was
-- built up from, and it is idempotent-safe only in the sense that it will fail
-- loudly on a project that already has these tables — which is the correct
-- behaviour for a destructive-by-accident script.
--
-- ============================================================================
-- The rule that governs every table here
-- ============================================================================
--
-- RLS is enabled everywhere with ZERO policies, which denies the `anon` and
-- `authenticated` roles outright. Nothing reaches Postgres except through the
-- Next.js server using the service-role key, after it has checked Clerk auth
-- and — for anything ranked — re-verified the solve itself by replaying the
-- move stream against the scramble it issued.
--
-- This is deliberate and it is the whole basis of the ladder. Handing the
-- browser a scoped key and writing RLS policies is less code, but it puts the
-- client on the write path for ratings and leaderboards. A rating the client
-- can PATCH is not a rating, and a leaderboard nobody believes is worse than no
-- leaderboard.
--
-- Supabase's linter will report `rls_enabled_no_policy` on all six tables.
-- That is the intended state, not a finding.

-- ---------------------------------------------------------------------------
-- Identity
-- ---------------------------------------------------------------------------

-- Clerk owns who someone is; this table owns who they are *here*. Joined on
-- `clerk_user_id` rather than adopting Clerk's id as the primary key, so moving
-- off Clerk later changes one column instead of every foreign key.
create table profiles (
  id             uuid primary key default gen_random_uuid(),
  clerk_user_id  text not null unique,
  -- Lowercase canonical form; this is what /u/<handle> resolves against.
  -- Mirrors `isValidHandle` in src/lib/handle.ts — if one changes, both must.
  handle         text not null unique
                 check (handle ~ '^[a-z0-9](?:[a-z0-9_-]{1,22}[a-z0-9])$'),
  -- The casing the player chose, shown in the UI. Purely cosmetic.
  display_name   text not null,
  country        text check (country ~ '^[A-Z]{2}$'),
  bio            text check (char_length(bio) <= 280),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Solves
-- ---------------------------------------------------------------------------

-- Every solve is stored whether or not it counts for rating, so a player's
-- history never quietly biases toward the solves that happened to verify.
create table solves (
  id            uuid primary key default gen_random_uuid(),
  profile_id    uuid not null references profiles(id) on delete cascade,
  -- The id the client generated. Sync replays the same solve on every retry and
  -- on every device, so uniqueness per player is what makes upload idempotent.
  client_id     text not null,
  event         text not null default '333',
  scramble      text not null,
  duration_ms   integer not null check (duration_ms >= 0),
  penalty       text not null check (penalty in ('OK', 'PLUS2', 'DNF')),
  move_count    integer not null default 0,
  tps           real not null default 0,
  -- 'manual' is a stopwatch time with no move stream behind it. It can never be
  -- verified, so it is kept for the player's own history and excluded from rating.
  source        text not null check (source in ('keyboard', 'smartcube', 'manual')),
  mode          text not null check (mode in ('practice', 'daily', 'duel', 'ranked')),

  -- Set by the server's own replay of the move stream, never by the client.
  verified      boolean not null default false,
  reject_reason text,
  moves         jsonb,
  splits        jsonb not null default '[]'::jsonb,
  oll_case      text,
  pll_case      text,

  day           integer,
  solved_at     timestamptz not null,
  created_at    timestamptz not null default now(),

  unique (profile_id, client_id)
);

create index solves_profile_recent on solves (profile_id, solved_at desc);
create index solves_ranked on solves (event, source, duration_ms)
  where verified and penalty <> 'DNF';

-- ---------------------------------------------------------------------------
-- Ranked attempts
-- ---------------------------------------------------------------------------

-- Ranked scrambles are issued by the server, not chosen by the client.
--
-- Without this the ladder is decorative: a client that picks its own scramble
-- can retry until it draws an easy one, or submit a solution prepared offline.
-- The server generates a random-state scramble that has never existed before the
-- request, remembers it, and accepts a solution to that exact scramble once.
create table ranked_attempts (
  id           uuid primary key default gen_random_uuid(),
  profile_id   uuid not null references profiles(id) on delete cascade,
  event        text not null default '333',
  pool         text not null check (pool in ('keyboard', 'smartcube')),
  scramble     text not null,
  issued_at    timestamptz not null default now(),
  -- An issued attempt that is never submitted expires, so scrambles cannot be
  -- hoarded and inspected at leisure before deciding which to actually solve.
  expires_at   timestamptz not null,

  status       text not null default 'issued'
               check (status in ('issued', 'completed', 'expired')),
  solve_id     uuid references solves(id) on delete set null,
  duration_ms  integer,
  penalty      text check (penalty in ('OK', 'PLUS2', 'DNF')),
  completed_at timestamptz,

  -- Which rating window consumed this attempt. Null until five have gathered.
  window_index integer
);

-- Windows are gathered by "has a result" rather than by status, because an
-- ABANDONED attempt is a result too. Otherwise the DNF rule is trivially
-- sidestepped: start an attempt, and if the solve goes badly walk away and ask
-- for another scramble. Chess settled this long ago — an abandoned game is a
-- loss — and the equivalent here is that a walked-away attempt enters the window
-- as a DNF.
create index ranked_attempts_pending
  on ranked_attempts (profile_id, event, pool, completed_at)
  where completed_at is not null and window_index is null;

create index ranked_attempts_open
  on ranked_attempts (profile_id, status);

-- ---------------------------------------------------------------------------
-- Rating
-- ---------------------------------------------------------------------------

-- Current rating, one row per player per event per input pool.
--
-- Keyboard cubing and hand cubing produce times that are not remotely
-- comparable, so they are separate ladders rather than one ladder with a filter.
-- The pool is part of the key, not a column to remember to filter on later.
create table ratings (
  profile_id    uuid not null references profiles(id) on delete cascade,
  event         text not null,
  pool          text not null check (pool in ('keyboard', 'smartcube')),
  rating        real not null,
  deviation     real not null,
  solve_count   integer not null default 0,
  peak_rating   real,
  last_solve_at timestamptz,
  updated_at    timestamptz not null default now(),
  primary key (profile_id, event, pool)
);

-- Leaderboards read this directly, so it carries its own index rather than
-- sorting the whole table per request.
create index ratings_board on ratings (event, pool, rating desc);

-- Append-only. The rating chart is drawn from this, and it is also the audit
-- trail: every point a rating moved has the window that moved it attached.
create table rating_events (
  id               bigserial primary key,
  profile_id       uuid not null references profiles(id) on delete cascade,
  solve_id         uuid references solves(id) on delete set null,
  event            text not null,
  pool             text not null,
  rating_before    real not null,
  deviation_before real not null,
  rating_after     real not null,
  deviation_after  real not null,
  window_index     integer,
  at               timestamptz not null default now(),

  -- Applying the same window twice — a double submit, a retry, two tabs — fails
  -- loudly here instead of quietly inflating someone's rating.
  constraint rating_events_one_per_window
    unique (profile_id, event, pool, window_index)
);

create index rating_events_profile on rating_events (profile_id, event, pool, at);

-- ---------------------------------------------------------------------------
-- The daily
-- ---------------------------------------------------------------------------

-- One attempt per player per day, enforced by the primary key — which is the
-- only place it can actually be enforced. The rule it replaces lived in
-- localStorage and reset whenever anyone cleared their storage.
create table daily_results (
  profile_id  uuid not null references profiles(id) on delete cascade,
  day         integer not null,
  event       text not null default '333',
  solve_id    uuid references solves(id) on delete set null,
  duration_ms integer not null,
  penalty     text not null check (penalty in ('OK', 'PLUS2', 'DNF')),
  verified    boolean not null default false,
  at          timestamptz not null default now(),
  primary key (profile_id, day, event)
);

create index daily_results_board on daily_results (day, event, penalty, duration_ms);

-- ---------------------------------------------------------------------------
-- Lock everything down. See the note at the top of this file.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Applying a rating window, atomically
-- ---------------------------------------------------------------------------

-- A rating update is three writes: claim the window, move the rating, mark the
-- five attempts as consumed. Issued separately from the application they are not
-- atomic, and the failure is both silent and permanent:
--
--   the window claim succeeds, the rating upsert fails -> the audit trail says
--   the rating moved, the rating did not, and because the window claim is
--   UNIQUE the window can never be retried. The player loses that update
--   forever and nothing anywhere reports a problem.
--
-- A single function call runs in one implicit transaction, so either all three
-- land or none do. The rating arithmetic itself deliberately stays in
-- TypeScript, where it is unit-tested; this function only commits a decision
-- that has already been made.
create function apply_rating_window(
  p_profile_id       uuid,
  p_event            text,
  p_pool             text,
  p_window_index     integer,
  p_rating_before    real,
  p_deviation_before real,
  p_rating_after     real,
  p_deviation_after  real,
  p_solve_count      integer,
  p_peak_rating      real,
  p_at               timestamptz,
  p_attempt_ids      uuid[]
) returns void
language plpgsql
as $$
begin
  -- Claims the window. The unique constraint is what turns a double submission
  -- into a loud failure rather than a rating applied twice.
  insert into rating_events (
    profile_id, event, pool, window_index,
    rating_before, deviation_before, rating_after, deviation_after, at
  ) values (
    p_profile_id, p_event, p_pool, p_window_index,
    p_rating_before, p_deviation_before, p_rating_after, p_deviation_after, p_at
  );

  insert into ratings (
    profile_id, event, pool, rating, deviation,
    solve_count, peak_rating, last_solve_at, updated_at
  ) values (
    p_profile_id, p_event, p_pool, p_rating_after, p_deviation_after,
    p_solve_count, p_peak_rating, p_at, p_at
  )
  on conflict (profile_id, event, pool) do update set
    rating        = excluded.rating,
    deviation     = excluded.deviation,
    solve_count   = excluded.solve_count,
    peak_rating   = excluded.peak_rating,
    last_solve_at = excluded.last_solve_at,
    updated_at    = excluded.updated_at;

  update ranked_attempts
     set window_index = p_window_index
   where id = any (p_attempt_ids);
end;
$$;

-- PostgREST exposes functions over HTTP and Postgres grants EXECUTE to PUBLIC by
-- default, so without this the browser could move its own rating with one POST —
-- which would undo the entire point of the server-authoritative write path.
revoke all on function apply_rating_window(
  uuid, text, text, integer, real, real, real, real, integer, real, timestamptz, uuid[]
) from public;

grant execute on function apply_rating_window(
  uuid, text, text, integer, real, real, real, real, integer, real, timestamptz, uuid[]
) to service_role;

alter table profiles        enable row level security;
alter table solves          enable row level security;
alter table ranked_attempts enable row level security;
alter table ratings         enable row level security;
alter table rating_events   enable row level security;
alter table daily_results   enable row level security;
