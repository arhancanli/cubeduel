-- Challenges: one player against another, on the same scramble.
--
-- Asynchronous on purpose. A live race needs two people online in the same
-- second, and a ladder that only works at peak concurrency does not work at all
-- for whoever shows up at 2am. The row below is also deliberately shaped so a
-- real-time mode can be layered on later without a second table: both sides are
-- symmetric and independently timestamped, so "live" is the special case where
-- the two `started_at` values happen to coincide.
--
-- Two columns carry the fairness guarantees, and both are enforced by what the
-- server refuses to send rather than by trust:
--
--   `scramble` is written at creation and released to each player only when
--   their own `*_started_at` is stamped. The challenger picks an opponent, not a
--   scramble — if either could read it early they would be studying a problem
--   the other solved cold.
--
--   `*_duration_ms` is never sent to the other player while status is 'pending'.
--   Going second is otherwise a genuine advantage: knowing you need 12.40 tells
--   you exactly how much risk to take.

create table challenges (
  id                      uuid primary key default gen_random_uuid(),
  challenger_id           uuid not null references profiles(id) on delete cascade,
  opponent_id             uuid not null references profiles(id) on delete cascade,
  event                   text not null default '333',
  source                  text not null default 'keyboard',

  -- Generated at creation, shown to nobody until their attempt opens.
  scramble                text not null,

  created_at              timestamptz not null default now(),
  expires_at              timestamptz not null,

  status                  text not null default 'pending'
                          check (status in ('pending', 'complete', 'expired', 'declined')),

  -- The challenger's half.
  challenger_started_at   timestamptz,
  challenger_solve_id     uuid references solves(id) on delete set null,
  challenger_duration_ms  integer check (challenger_duration_ms >= 0),
  challenger_penalty      text check (challenger_penalty in ('OK', 'PLUS2', 'DNF')),

  -- The opponent's half, identical in every respect.
  opponent_started_at     timestamptz,
  opponent_solve_id       uuid references solves(id) on delete set null,
  opponent_duration_ms    integer check (opponent_duration_ms >= 0),
  opponent_penalty        text check (opponent_penalty in ('OK', 'PLUS2', 'DNF')),

  winner                  text check (winner in ('challenger', 'opponent', 'draw')),
  resolved_at             timestamptz,

  -- Challenging yourself would be a free win against a real opponent's record.
  constraint challenges_not_self check (challenger_id <> opponent_id)
);

-- The inbox: "what is waiting for me", which is the query that runs on every
-- page load for every signed-in player.
create index challenges_inbox
  on challenges (opponent_id, created_at desc) where status = 'pending';

-- Both players' history, for a profile page and a record.
create index challenges_challenger_recent on challenges (challenger_id, created_at desc);
create index challenges_opponent_recent on challenges (opponent_id, created_at desc);

-- One outstanding challenge per direction. Without this a player could bury
-- somebody under a hundred pending challenges, and an inbox that can be used as
-- a weapon is a feature nobody will keep enabled.
create unique index challenges_one_pending_per_pair
  on challenges (challenger_id, opponent_id) where status = 'pending';

-- Deny-all, like every other table here. The browser never writes; route
-- handlers do, with the service role, after checking Clerk auth. A result the
-- client can PATCH is not a result.
alter table challenges enable row level security;
