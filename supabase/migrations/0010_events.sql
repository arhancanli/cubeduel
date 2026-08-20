-- What people actually do here.
--
-- Nothing in this application has ever been able to answer the questions that
-- decide whether it is working: does somebody who lands here complete a solve,
-- do they come back for a second session, and are they here tomorrow. Every
-- judgement about the product so far has been made without them.
--
-- ============================================================================
-- Why this is a table and not an analytics provider
-- ============================================================================
--
-- The questions above are retention questions, and they need a persistent
-- identifier per visitor. Privacy-first hosted analytics deliberately refuse to
-- keep one — that is the whole point of them — so they can report how many
-- people arrived and cannot report whether the same person came back. They
-- would answer the question this app does not need and refuse the one it does.
--
-- So it is first-party, it is here, and it obeys the rules written on it:
--
--   * The identifier is a random value in `localStorage`. It is not derived
--     from anything about the person, it is not a cookie, and it is never sent
--     anywhere but this origin.
--   * No IP address is stored. The events table has no column for one, which
--     is a stronger guarantee than a policy.
--   * `Do Not Track` and Global Privacy Control are honoured in the client,
--     and a visitor who sets either is never given an identifier at all.
--   * Event names come from a fixed allowlist in `src/lib/analytics.ts`. This
--     endpoint is public and writable, so without that it is a free-text store
--     anybody can fill.

create table events (
  id         uuid primary key default gen_random_uuid(),

  -- A random value the browser generated for itself. Deliberately opaque and
  -- deliberately not a hash of anything — a fingerprint would be an identifier
  -- the person cannot clear, which is the thing this is trying not to be.
  visitor    text not null check (char_length(visitor) between 8 and 64),

  -- One per browser session, so time-on-site can be measured without keeping
  -- anything that outlives the visit.
  session    text check (session is null or char_length(session) between 8 and 64),

  -- The account, when there is one. Most rows have none: the product works
  -- signed out and that is the point.
  --
  -- `on delete cascade` rather than `set null`. Somebody who deletes their
  -- account has asked to be gone, and keeping their behaviour under an
  -- anonymous label would be keeping the data while claiming not to.
  user_id    uuid references users(id) on delete cascade,

  -- Constrained by an allowlist in code rather than by an enum here, so adding
  -- an event does not need a migration. The check keeps the column sane if the
  -- code check is ever bypassed.
  name       text not null check (char_length(name) between 1 and 40),

  -- Small, bounded context: which event, which mode. Never anything a person
  -- typed and never anything about them.
  props      jsonb,

  at         timestamptz not null default now()
);

-- The three questions this table exists for, and the indexes that answer them.

-- "Did this visitor come back?" — every retention figure walks a visitor's
-- events in time order.
create index events_visitor_idx on events (visitor, at);

-- "How many people did X on day Y?" — the funnel and the daily counts.
create index events_name_at_idx on events (name, at desc);

-- "What did this account do?" — only for accounts, only for support.
create index events_user_idx on events (user_id, at desc) where user_id is not null;

-- As everywhere else in this schema: enabled with no policies, so `anon` and
-- `authenticated` are denied outright. Writes arrive through a route handler
-- that validates the event name against the allowlist first — the browser is
-- never given a path to this table.
alter table events enable row level security;
