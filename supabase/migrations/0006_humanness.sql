-- How human a solve looked.
--
-- Verification proves a move stream really solves the scramble it was issued
-- for. It cannot prove a person produced it — a program that solves the cube and
-- replays the answer at a believable speed passes every check, and always will.
-- `src/lib/humanness.ts` looks at *how* the moves arrived instead: how many there
-- were, whether the turning paused the way people pause, and whether the rhythm
-- wandered the way hands wander.
--
-- Stored, not acted on. Nothing here bans anybody and nothing consults this
-- column at submission time. Every signal behind it is evidence with a
-- false-positive story attached, and a ladder that auto-banned on a statistic
-- would eventually throw out a real player having an extraordinary solve. That
-- is the worse failure: a missed cheat costs one rating, a wrongly banned player
-- costs the belief the whole thing runs on.
--
-- What it is for is review. A run of flagged solves from one account is a
-- question worth asking a person; a single one is not.
--
--   select p.handle, count(*) filter (where s.humanness >= 0.8) as flagged,
--          count(*) as solves
--     from solves s join profiles p on p.id = s.profile_id
--    where s.mode in ('ranked', 'rush', 'challenge')
--    group by p.handle
--   having count(*) filter (where s.humanness >= 0.8) > 3
--    order by flagged desc;

alter table solves add column if not exists humanness real
  check (humanness is null or (humanness >= 0 and humanness <= 1));

-- Null means "not assessed" — solves recorded before this existed, and streams
-- too short to say anything about. A default of zero would have claimed every
-- one of them looked human, which is a claim nothing measured.
comment on column solves.humanness is
  '0 = looks human, 1 = looks generated. Null = not assessed. Advisory only.';

create index solves_flagged on solves (profile_id, solved_at desc)
  where humanness >= 0.8;
