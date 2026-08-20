-- The profile join moves off Clerk.
--
-- `profiles.user_id` was added in 0007 and has been sitting unused; this is the
-- migration that makes it the join and lets `clerk_user_id` go quiet. Every
-- solve, rating, duel, challenge and rush run keeps pointing at the same
-- `profiles.id` throughout — that was the whole point of joining on a column
-- rather than adopting the identity provider's id as a primary key, and it is
-- the promise the original schema comment made about this exact day.
--
-- ============================================================================
-- Why the old column is kept
-- ============================================================================
--
-- `clerk_user_id` becomes nullable rather than being dropped.
--
-- Dropping it in the same migration that starts writing the new one leaves no
-- state in which a half-deployed application works: a server still running the
-- previous build inserts a `clerk_user_id` into a column that no longer exists
-- and every sign-in breaks. Nullable is the step that both builds survive.
--
-- It also keeps the record of which profiles predate the move, which is the only
-- way to tell an account that was migrated from one created afterwards. Dropping
-- it is a later migration, deliberately taken separately and only once nothing
-- reads it.

alter table profiles alter column clerk_user_id drop not null;

-- A profile now belongs to an account here, or to nothing yet. Both unique
-- indexes stay, and they mean different things when a write loses a race:
--
--   profiles_user_id_key  — another request for THIS SAME player won. Its row is
--                           the correct answer and the loser should return it.
--   profiles_handle_key   — a DIFFERENT player already has that name. The loser
--                           should try the next candidate.
--
-- `src/lib/server/profileStore.ts` tells them apart by constraint name, which is
-- why these are named after their columns and must stay that way. A profile race
-- that mistakes one for the other is how a new account's first page load broke
-- for everybody whose display name was popular.

comment on column profiles.clerk_user_id is
  'Dead. Identity moved in-house at migration 0009; see profiles.user_id. Kept
   nullable so that profiles predating the move remain identifiable, and so a
   half-deployed rollout survives. Nothing reads it.';

comment on column profiles.user_id is
  'The account this profile belongs to. Null only for rows that predate 0009 and
   were never migrated — those are unreachable, because there is no longer any
   way to sign in as them.';
