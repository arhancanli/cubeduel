-- The weekly competition.
--
-- Five scrambles, the same for everybody, one attempt at each, ranked by the
-- WCA average of five. It is cubing's version of a tournament: not a bracket —
-- a solo sport has no head-to-head game to bracket — but the thing the sport
-- already does every weekend, which is everybody solving the same five and
-- comparing averages.
--
-- Every rule of ranked applies to each attempt, because each attempt IS a
-- ranked-style attempt: the scramble is issued by the server when you open it
-- and not before, the moves are replayed against it, inspection is timed from
-- the server's own clock, and an attempt you walk away from is a DNF.
--
-- What is different is that the five are shared. They are generated fresh,
-- server-side, the first time anybody asks during the week, and stored only
-- here — never in the repository, the way the daily's are. A shared scramble
-- can be passed around by somebody who has already seen it; that is true of
-- every online competition, and it is why a result here says it was verified
-- (the moves solve it, inside the time) rather than that it was unassisted.

create table weekly_rounds (
  -- The ISO week in UTC, "2026-W39".
  week        text primary key check (week ~ '^\d{4}-W\d{2}$'),
  event       text not null default '333',
  scrambles   text[] not null check (array_length(scrambles, 1) = 5),
  created_at  timestamptz not null default now()
);

create table weekly_attempts (
  id           uuid primary key default gen_random_uuid(),
  week         text not null references weekly_rounds(week) on delete cascade,
  profile_id   uuid not null references profiles(id) on delete cascade,
  -- Which of the five, from 0. The key below makes each one issuable once.
  idx          smallint not null check (idx between 0 and 4),
  pool         text not null check (pool in ('keyboard', 'smartcube')),
  issued_at    timestamptz not null default now(),
  expires_at   timestamptz not null,
  status       text not null default 'issued' check (status in ('issued', 'completed', 'expired')),
  solve_id     uuid references solves(id) on delete set null,
  duration_ms  integer,
  penalty      text check (penalty in ('OK', 'PLUS2', 'DNF')),
  completed_at timestamptz,

  -- One attempt per scramble per player, enforced by the key rather than by a
  -- count the server reads first: two tabs asking at once must not both get
  -- attempt three.
  unique (week, profile_id, pool, idx)
);

-- The results board: everybody's attempts for one week.
create index weekly_attempts_board on weekly_attempts (week, pool) where completed_at is not null;

-- A solve made in the weekly records itself as one.
alter table solves drop constraint if exists solves_mode_check;
alter table solves add constraint solves_mode_check
  check (mode in ('practice', 'daily', 'duel', 'ranked', 'challenge', 'rush', 'race', 'weekly'));

comment on table weekly_rounds is
  'One row per ISO week: the five shared scrambles, generated server-side on
   first request. Never exposed until an attempt at each is issued, and shown
   in full only once the week has closed.';

-- As everywhere: the browser reads none of it. The scrambles especially.
alter table weekly_rounds   enable row level security;
alter table weekly_attempts enable row level security;
