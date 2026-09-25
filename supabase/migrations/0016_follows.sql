-- Following another player.
--
-- One-way, like following somebody's games rather than friending them: a
-- profile is already public, so following it asks nobody's permission and
-- reveals nothing that was not on the page. What it changes is what *you* see
-- — the people you follow on the leaderboard beside you, and their time on
-- today's daily once you have posted yours. That is the whole feature. There
-- is no feed, no notification and no message: a solo sport needs somebody to
-- measure yourself against far more than it needs a social network.

create table follows (
  follower_id uuid not null references profiles(id) on delete cascade,
  followee_id uuid not null references profiles(id) on delete cascade,
  created_at  timestamptz not null default now(),

  -- Following twice is following once. The key refuses the second row rather
  -- than a check-then-insert, so two tabs cannot race a duplicate in.
  primary key (follower_id, followee_id),

  constraint follows_not_self check (follower_id <> followee_id)
);

-- "Who follows me?" — the count on a profile. The primary key already serves
-- "who do I follow?".
create index follows_followee_idx on follows (followee_id);

comment on table follows is
  'One-way follows between profiles. A player may follow at most 500 others
   (enforced in server/follows.ts). Read and written only by server code.';

-- As everywhere: enabled with no policies, so the browser cannot read it.
alter table follows enable row level security;

-- ---------------------------------------------------------------------------
-- You and the people you follow
-- ---------------------------------------------------------------------------

-- Joined here rather than by sending every followed id back in a request: five
-- hundred ids in a PostgREST filter is an eighteen-kilobyte URL, past what
-- proxies reliably pass. The server calls these with the service role; nobody
-- else can (see the revokes below, and 0001 for why PUBLIC alone is not enough).

create function circle_board(p_profile uuid)
returns table (handle text, display_name text, rating real, deviation real, is_you boolean)
language sql stable
set search_path = public, pg_temp
as $$
  select p.handle, p.display_name, r.rating, r.deviation, p.id = p_profile
  from profiles p
  left join ratings r
    on r.profile_id = p.id and r.event = '333' and r.pool = 'keyboard'
  where p.id = p_profile
     or p.id in (select followee_id from follows where follower_id = p_profile)
$$;

create function circle_daily(p_profile uuid, p_day integer)
returns table (handle text, display_name text, duration_ms integer, penalty text, verified boolean, is_you boolean)
language sql stable
set search_path = public, pg_temp
as $$
  select p.handle, p.display_name, d.duration_ms, d.penalty, d.verified, p.id = p_profile
  from daily_results d
  join profiles p on p.id = d.profile_id
  where d.day = p_day and d.event = '333'
    and (d.profile_id = p_profile
         or d.profile_id in (select followee_id from follows where follower_id = p_profile))
$$;

revoke all on function circle_board(uuid) from public, anon, authenticated;
revoke all on function circle_daily(uuid, integer) from public, anon, authenticated;
grant execute on function circle_board(uuid) to service_role;
grant execute on function circle_daily(uuid, integer) to service_role;
