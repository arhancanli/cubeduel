-- Live races: two players, one scramble, the same moment. See src/lib/race.ts.
--
-- One row per race, with both seats on it — the same shape `challenges` took, for
-- the same reason: every rule here is about the two sides relative to each
-- other, and a row per seat would make each of them a join.
--
-- The scramble is NULL until both players are ready, and generated then; the
-- server withholds it until `start_at` even after it exists (see
-- `scrambleVisible`). Nothing here reaches `ratings` — a race is a game between
-- two people, like a duel or a challenge, and speed does not depend on being
-- raced.

create table races (
  id                 uuid primary key default gen_random_uuid(),

  -- The address: /race/<code>. Eight characters from an alphabet without the
  -- ones people misread (i, l, o, 0, 1), because it is shared by hand.
  code               text not null unique check (code ~ '^[a-hjkmnp-z2-9]{8}$'),

  event              text not null default '333',
  scramble           text,

  host_id            uuid not null references profiles(id) on delete cascade,
  guest_id           uuid references profiles(id) on delete cascade,
  host_ready         boolean not null default false,
  guest_ready        boolean not null default false,

  created_at         timestamptz not null default now(),
  -- When a race that never started lapses.
  expires_at         timestamptz not null,
  -- When the scramble appears on both screens. Set once, when both are ready.
  start_at           timestamptz,

  status             text not null default 'lobby'
                     check (status in ('lobby', 'started', 'finished', 'abandoned')),

  -- Shown to the other player while the race runs. Display only: it decides
  -- nothing, so it is bounded on the way in rather than verified.
  host_progress      jsonb,
  guest_progress     jsonb,

  host_solve_id      uuid references solves(id) on delete set null,
  host_duration_ms   integer check (host_duration_ms >= 0),
  host_penalty       text check (host_penalty in ('OK', 'PLUS2', 'DNF')),

  guest_solve_id     uuid references solves(id) on delete set null,
  guest_duration_ms  integer check (guest_duration_ms >= 0),
  guest_penalty      text check (guest_penalty in ('OK', 'PLUS2', 'DNF')),

  winner             text check (winner in ('host', 'guest', 'draw')),
  finished_at        timestamptz,

  -- The next race between the same two, once either asks for one, so the other
  -- player's screen can follow them into it.
  rematch_code       text,

  constraint races_not_self check (host_id <> guest_id)
);

create index races_host_recent on races (host_id, created_at desc);
create index races_guest_recent on races (guest_id, created_at desc) where guest_id is not null;

alter table races enable row level security;

-- A race solve is a solve. Omitting the mode here is exactly how challenge solves
-- once failed to store, silently, for as long as nobody checked the rows.
alter table solves drop constraint if exists solves_mode_check;

alter table solves add constraint solves_mode_check
  check (mode in ('practice', 'daily', 'duel', 'ranked', 'challenge', 'rush', 'race'));
