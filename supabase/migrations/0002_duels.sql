-- Duels: racing a committed opponent.
--
-- The important column here is `bot_moves`. The opponent's ENTIRE trajectory —
-- every move and the millisecond it lands on — is written when the duel is
-- created, before the player has turned a single face. It is therefore
-- impossible for the bot to speed up when it is losing or slow down when it is
-- winning, and that is not a promise in a comment: the row exists, timestamped,
-- from before the race started.
--
-- Rubber-banding is the standard way racing games are dishonest, and it is
-- exactly the sort of thing this app cannot do and still claim a rating means
-- something.
--
-- Because the trajectory is fixed and deterministic, it is also handed to the
-- client at the start. The opponent's progress bar is then rendered locally from
-- the real move stream with no polling at all — the race needs no realtime
-- channel, which is what makes bot duels shippable on this architecture.

create table duels (
  id                uuid primary key default gen_random_uuid(),
  profile_id        uuid not null references profiles(id) on delete cascade,
  event             text not null default '333',
  scramble          text not null,

  -- The opponent, and the race it committed to.
  bot_id            text not null,
  bot_rating        real not null,
  bot_duration_ms   integer not null check (bot_duration_ms > 0),
  bot_moves         jsonb not null,
  seed              integer not null,

  issued_at         timestamptz not null default now(),
  expires_at        timestamptz not null,

  status            text not null default 'open'
                    check (status in ('open', 'finished', 'abandoned')),

  -- The player's side, once they have one.
  solve_id          uuid references solves(id) on delete set null,
  player_duration_ms integer,
  player_penalty    text check (player_penalty in ('OK', 'PLUS2', 'DNF')),
  outcome           text check (outcome in ('win', 'loss')),
  completed_at      timestamptz
);

create index duels_profile_recent on duels (profile_id, issued_at desc);

-- One open duel at a time per player, enforced rather than assumed: without it
-- a player could hold several races and submit only the one that went well,
-- which is the same highlight-reel problem the ranked reroll rule exists to stop.
create unique index duels_one_open_per_profile
  on duels (profile_id) where status = 'open';

alter table duels enable row level security;
