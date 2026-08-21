-- Clubs.
--
-- Cubing is a solo sport. You solve alone against a clock, which is why csTimer
-- — a free solo timer — still dominates, and why the network effect that makes
-- chess.com unassailable does not exist here. A ladder in a solo sport is a
-- scoreboard, not a reason two people both have to turn up.
--
-- A club is the closest thing to that reason this sport offers. School and
-- university cubing clubs exist in their thousands, they already meet, and they
-- already compare times informally. This gives that comparison somewhere to
-- live — and it is the one feature where one person joining brings twenty.
--
-- ============================================================================
-- The rule that makes it worth anything
-- ============================================================================
--
-- A club leaderboard reads the SAME verified ratings as the global one. There
-- is no club-local scoring, no separate ladder, and no way to be ranked inside
-- a club on anything the main ladder would not accept.
--
-- The temptation is obvious and it is a trap: a private board with friendlier
-- numbers is more flattering and completely worthless. The entire claim of this
-- product is that a rating means something, and a rating that means something
-- different depending on who is looking does not.

create table clubs (
  id          uuid primary key default gen_random_uuid(),

  -- What /c/<slug> resolves against. Same shape as a handle, and deliberately
  -- from the same character set: these two namespaces are the only user-chosen
  -- strings that land in a URL path, and one set of rules is easier to hold to
  -- than two that drift.
  slug        text not null unique
              check (slug ~ '^[a-z0-9](?:[a-z0-9_-]{1,30}[a-z0-9])$'),

  name        text not null check (char_length(name) between 2 and 60),
  bio         text check (char_length(bio) <= 280),

  -- Who made it. Kept even after they leave, because "who started this" is a
  -- fact about the club rather than a role in it.
  created_by  uuid references profiles(id) on delete set null,

  -- What somebody types or follows to get in.
  --
  -- Not a secret in the cryptographic sense — it is meant to be pasted into a
  -- group chat — so it is stored in the clear, unlike every other token in this
  -- schema. What it protects is "not everybody on the internet", which is a
  -- lower bar than an account and is the right one: a club that needs approval
  -- for every member is a club that never grows past its founder's patience.
  join_code   text not null unique
              check (join_code ~ '^[a-z0-9]{6,12}$'),

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Membership
-- ---------------------------------------------------------------------------

create table club_members (
  club_id    uuid not null references clubs(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,

  -- Two roles and no more. An owner can rename the club, roll its join code and
  -- remove members; everybody else is a member. Cubing clubs are small enough
  -- that a permission system would be a way of making the product about
  -- administration.
  role       text not null default 'member' check (role in ('owner', 'member')),

  joined_at  timestamptz not null default now(),

  -- One membership per person per club, enforced by the key rather than by a
  -- check-then-insert. Somebody who follows an invite link twice, or has it open
  -- in two tabs, must not end up listed twice on the board.
  primary key (club_id, profile_id)
);

-- The club page: every member, newest last.
create index club_members_club_idx on club_members (club_id, joined_at);

-- "Which clubs am I in?" — shown on every profile and in the nav.
create index club_members_profile_idx on club_members (profile_id);

-- ---------------------------------------------------------------------------
-- Limits, as columns rather than as intentions
-- ---------------------------------------------------------------------------

-- How many clubs one person may create. Enforced in `server/clubs.ts` by
-- counting, because a partial unique index cannot express "at most five" — but
-- recorded here so the number is discoverable from the schema rather than only
-- from the code that happens to check it.
comment on table clubs is
  'A cubing club. Members are ranked by the same verified ratings as the global
   leaderboard — there is deliberately no club-local scoring. One person may
   create at most 5 clubs (enforced in server/clubs.ts), and a club holds at
   most 500 members: past that it is a leaderboard, not a club.';

comment on column clubs.join_code is
  'Stored in the clear, unlike every other token in this schema, because it is
   meant to be pasted into a group chat. It protects against "everybody on the
   internet", not against a determined attacker — joining still requires an
   account, and nothing about membership grants access to anybody else data.';

-- ---------------------------------------------------------------------------
-- Deny everything
-- ---------------------------------------------------------------------------

-- As everywhere else: enabled with no policies, so `anon` and `authenticated`
-- are denied outright and every read goes through server code. The club page is
-- public, but "public" here means a server component renders it — not that the
-- browser may query the table.
alter table clubs        enable row level security;
alter table club_members enable row level security;
