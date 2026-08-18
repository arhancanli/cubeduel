-- Rush: solve under a target that keeps tightening, until you miss three.
--
-- A run is a single row that walks forward. It holds the scramble currently
-- issued and when it went out, so each solve is verified against a scramble the
-- server chose, exactly as a ranked one is — the mode is fast, but it is not
-- less checked for being fast.
--
-- `pace_ms` is captured once, when the run starts, and never recomputed. The
-- whole run's targets derive from it, so letting it move mid-run would let a
-- player lower their own bar by submitting a slow solve to a different mode
-- while a run was open.
--
-- The score is NOT taken from the client. It is replayed on the server from the
-- recorded solves by the same pure function the browser uses, and a mismatch is
-- resolved in favour of the replay. A score the server cannot reproduce is not a
-- score, it is a claim.

create table rush_runs (
  id                uuid primary key default gen_random_uuid(),
  profile_id        uuid not null references profiles(id) on delete cascade,
  event             text not null default '333',
  source            text not null default 'keyboard',

  -- Fixed at the start. Every target in the run is derived from this.
  pace_ms           integer not null check (pace_ms > 0),

  started_at        timestamptz not null default now(),
  expires_at        timestamptz not null,
  ended_at          timestamptz,

  status            text not null default 'open'
                    check (status in ('open', 'finished', 'abandoned')),

  -- The scramble waiting to be solved, and when it was issued. Null between the
  -- last solve and the next issue.
  current_scramble  text,
  current_issued_at timestamptz,

  score             integer not null default 0 check (score >= 0),
  misses            integer not null default 0 check (misses >= 0),
  best_streak       integer not null default 0 check (best_streak >= 0)
);

create index rush_runs_profile_recent on rush_runs (profile_id, started_at desc);

-- One open run per player. Without it somebody could hold several runs and
-- submit only the one that went well — the same highlight-reel problem the
-- ranked reroll rule exists to stop.
create unique index rush_runs_one_open_per_profile
  on rush_runs (profile_id) where status = 'open';

-- The leaderboard query: best finished run per event.
create index rush_runs_best on rush_runs (event, score desc) where status = 'finished';

create table rush_solves (
  run_id       uuid not null references rush_runs(id) on delete cascade,
  -- Position in the run, from zero. Part of the key so a solve cannot be
  -- recorded twice for the same position.
  position     integer not null check (position >= 0),
  solve_id     uuid references solves(id) on delete set null,
  duration_ms  integer not null check (duration_ms >= 0),
  penalty      text not null check (penalty in ('OK', 'PLUS2', 'DNF')),
  -- Stored rather than recomputed, so a later change to the tightening curve
  -- cannot silently rewrite what an old run was actually asked to beat.
  target_ms    integer not null check (target_ms > 0),
  cleared      boolean not null,
  at           timestamptz not null default now(),

  primary key (run_id, position)
);

create index rush_solves_run on rush_solves (run_id, position);

alter table rush_runs enable row level security;
alter table rush_solves enable row level security;

-- Rush solves are real solves and belong in the same table as every other one,
-- which means the mode enum has to know about them. Leaving this out is exactly
-- how challenge solves silently failed to store for the whole life of that
-- feature: the insert failed the check constraint, the error was discarded, and
-- the result was recorded with no evidence behind it.
alter table solves drop constraint if exists solves_mode_check;

alter table solves add constraint solves_mode_check
  check (mode in ('practice', 'daily', 'duel', 'ranked', 'challenge', 'rush'));
