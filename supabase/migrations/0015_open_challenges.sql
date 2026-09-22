-- An open challenge: the second seat is empty until somebody takes it.
--
-- A named challenge needs a handle you already know, and a live race needs a
-- friend to send a link to. Neither works for somebody who arrives here knowing
-- nobody — which, on a new site, is everybody. So the opponent becomes optional:
-- the offer sits on a board, and whoever turns up next takes it.
--
-- Nothing about fairness changes. The scramble is still generated at creation
-- and shown to neither side until their own attempt opens, so accepting an offer
-- six hours later confers nothing.

alter table challenges alter column opponent_id drop not null;

-- The board: unclaimed offers, newest first. Partial, because claimed ones are
-- the overwhelming majority and this query never wants them.
create index challenges_open
  on challenges (created_at desc)
  where opponent_id is null and status = 'pending';

-- Worth stating what the existing constraints already do with a null opponent,
-- because both were written when there could not be one:
--
--   challenges_not_self           `challenger_id <> opponent_id` is NULL, which
--                                 a check constraint passes. Correct here: an
--                                 unclaimed offer is nobody's, so it cannot be
--                                 your own seat yet. The server refuses your own
--                                 offer at accept time instead, where the seat
--                                 actually gets filled.
--   challenges_one_pending_per_pair
--                                 a unique index treats NULLs as distinct, so
--                                 open challenges do not collide with each
--                                 other. The cap on how many one player may
--                                 leave on the board is MAX_OPEN_PER_PLAYER,
--                                 counted at creation.
