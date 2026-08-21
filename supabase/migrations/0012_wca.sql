-- World Cube Association links.
--
-- The question only a site with a real rating can ask: how does what somebody
-- does here compare to what they did at a competition? It is also the easiest
-- place in this product to say something false, and the whole design of this
-- table is about not doing that.
--
-- ============================================================================
-- A link is proved, never claimed
-- ============================================================================
--
-- There is deliberately no way to type in a WCA id. A WCA id is public — every
-- one of them is on worldcubeassociation.org — so a text field would let
-- anybody attach a world-class competition average to their profile, and the
-- number shown beside their name would be a lie that looks exactly like the
-- truth.
--
-- The only way in is the WCA's own OAuth: the person signs in to the WCA, the
-- WCA tells us who they are, and `verified_at` records the moment it did. A row
-- here cannot exist without that having happened, which is why the column is
-- `not null`.
--
-- The consequence is worth stating: with no OAuth credentials configured, this
-- feature is simply not offered. That is the correct failure — an unverifiable
-- link is worse than no link.

create table wca_links (
  -- One profile, one WCA id. The primary key rather than a separate id, because
  -- "this person's WCA link" is the only way this table is ever read.
  profile_id     uuid primary key references profiles(id) on delete cascade,

  -- Format enforced here as well as in `wca.ts`: four digits of year, four
  -- letters of surname, two digits. It goes straight into a URL on
  -- worldcubeassociation.org, so a malformed one is a request that should never
  -- have been made.
  wca_id         text not null unique
                 check (wca_id ~ '^[0-9]{4}[A-Z]{4}[0-9]{2}$'),

  -- The moment the WCA confirmed this person is who they say. Not nullable:
  -- there is no such thing as an unverified link here, and a nullable column
  -- would be an invitation to add one later without noticing what it costs.
  verified_at    timestamptz not null default now(),

  -- Cached from the WCA's public API so the profile page does not make a
  -- third-party request on every view. Records change only when somebody
  -- competes, which is a few times a year at most.
  name           text,
  country        text,
  competitions   integer,
  records        jsonb,
  refreshed_at   timestamptz,

  created_at     timestamptz not null default now()
);

-- `unique` on wca_id already, and it matters: two accounts claiming the same
-- competitor would put the same official average beside two different names.
-- The person who proved it first keeps it.

comment on table wca_links is
  'Proved by WCA OAuth, never typed. A WCA id is public, so a text field would
   let anybody attach a world-class average to their profile. The cached records
   are display only — nothing here writes to `ratings` or reaches a leaderboard,
   because a rating on this ladder is earned by solves this server issued a
   scramble for and replayed.';

-- ---------------------------------------------------------------------------
-- OAuth state
-- ---------------------------------------------------------------------------

-- The `state` parameter, stored rather than trusted.
--
-- Same reasoning as `webauthn_challenges`: a value the client supplies is a
-- value the attacker supplies. Without a server-side record, an attacker can
-- start a flow with their own WCA account and hand the finished callback URL to
-- somebody else — who would silently end up with the attacker's competition
-- results attached to their profile.
create table wca_oauth_states (
  id          uuid primary key default gen_random_uuid(),

  -- SHA-256 of the value sent to the WCA, for consistency with every other
  -- token column here.
  state_hash  bytea not null unique,

  -- Which account started the flow. The callback completes for this profile and
  -- no other, however the browser arrives.
  profile_id  uuid not null references profiles(id) on delete cascade,

  expires_at  timestamptz not null,
  created_at  timestamptz not null default now()
);

create index wca_oauth_states_expires_idx on wca_oauth_states (expires_at);

alter table wca_links        enable row level security;
alter table wca_oauth_states enable row level security;
