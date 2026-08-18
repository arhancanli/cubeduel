-- Let a solve say it came from a challenge.
--
-- `solves.mode` was constrained to practice/daily/duel/ranked, written before
-- challenges existed. Every challenge solve therefore failed this check on
-- insert — and because the insert's error was discarded, the challenge went on
-- to record a winner with `challenger_solve_id`/`opponent_solve_id` left null.
--
-- So head-to-head results existed with no stored solve behind them. That is
-- precisely the thing this app claims cannot happen: every result is supposed to
-- be a solve the server replayed and kept. The outcome was still computed from a
-- verified move stream, so nothing incorrect was ever shown to a player, but the
-- evidence was not there to inspect afterwards.
--
-- Two changes went in alongside this one, and they matter more than the missing
-- enum value: the insert now refuses to record a result if the solve did not
-- store, and the integration suite asserts the solve row exists rather than
-- trusting that a returned "accepted" meant it did.

alter table solves drop constraint if exists solves_mode_check;

alter table solves add constraint solves_mode_check
  check (mode in ('practice', 'daily', 'duel', 'ranked', 'challenge'));
