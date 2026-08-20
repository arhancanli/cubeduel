-- Identity, owned here instead of rented.
--
-- Until this migration the answer to "who is this?" came from Clerk, and
-- `profiles.clerk_user_id` was the join. That worked, but it put the most
-- load-bearing question in the product — is this really the person whose rating
-- this is? — behind a vendor whose development instance caps out at a hundred
-- users and whose sign-up form started rendering an unsolvable CAPTCHA to our
-- own test harness partway through a session.
--
-- The schema was built expecting this. `profiles` joined on `clerk_user_id`
-- rather than adopting Clerk's id as its primary key precisely so that moving
-- off it would change one column instead of every foreign key. This is that one
-- column: every solve, rating, duel, challenge and rush run keeps pointing at
-- the same `profiles.id` it always did.
--
-- ============================================================================
-- The rule that governs the secrets in here
-- ============================================================================
--
-- Nothing in this file stores a credential that could be replayed if the
-- database leaked. Session cookies and email links are random 32-byte values
-- held by the client; what is stored is their SHA-256. A lookup hashes the
-- incoming value and matches on that, so a full dump of `sessions` grants
-- nobody a session and a full dump of `email_tokens` lets nobody reset a
-- password.
--
-- This costs nothing. These are high-entropy random tokens, not passwords, so
-- there is nothing to brute-force and no reason for a slow hash — the entire
-- risk being defended against is a stolen table, and a fast hash defeats that
-- completely.
--
-- Passwords are the opposite case and are handled the opposite way: scrypt with
-- a per-password salt, in `src/lib/auth/password.ts`.
--
-- RLS is enabled on every table here with ZERO policies, exactly as everywhere
-- else in this schema. `anon` and `authenticated` are denied outright; nothing
-- reaches these rows except the Next.js server holding the service-role key.
-- For the tables that hold session material that is not a stylistic choice.

-- ---------------------------------------------------------------------------
-- Users
-- ---------------------------------------------------------------------------

-- A person's account. Deliberately thin: an address to reach them at, an
-- optional password, and nothing else. Everything a player can see about
-- themselves — handle, display name, country, bio — already lives on `profiles`
-- and stays there. Keeping the two apart means the table holding credentials is
-- never read to render a page.
create table users (
  id                uuid primary key default gen_random_uuid(),

  -- Stored already-normalised so that uniqueness is a plain constraint rather
  -- than a functional index nobody remembers to match at the call site. The
  -- check makes the normalisation a fact about the column instead of a promise
  -- the application makes: `Someone@Example.com` and `someone@example.com`
  -- cannot both exist, and neither can a row that skipped `normaliseEmail`.
  email             text not null unique check (email = lower(email)),

  -- Null until they click the link. Unverified accounts are deliberately still
  -- usable: the whole product stance is that an account earns itself after
  -- someone already cares, and refusing to let a person solve until they have
  -- been to their inbox is the same wall in a different coat. What verification
  -- gates is recovery — see `email_tokens`.
  email_verified_at timestamptz,

  -- Null is a real and expected state: an account created with a passkey has no
  -- password and never needs one. A not-null column here would have forced
  -- every passkey-only user to invent a secret purely to satisfy the schema,
  -- which is the exact thing passkeys exist to stop.
  --
  -- Format is self-describing (`scrypt$N$r$p$salt$hash`) so the algorithm can be
  -- changed later without guessing what an old row was hashed with.
  password_hash     text,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Profiles, re-pointed
-- ---------------------------------------------------------------------------

-- The one column the original schema comment promised this migration would be.
--
-- Nullable and alongside `clerk_user_id` rather than replacing it, because a
-- cutover that drops the old join in the same statement that adds the new one
-- has no state in which both halves of the application work. Phase E drops
-- `clerk_user_id` once nothing reads it.
alter table profiles add column if not exists user_id uuid
  references users(id) on delete cascade;

create unique index if not exists profiles_user_id_key on profiles (user_id);

-- Deleting an account has to take the profile with it. That was true before —
-- the Clerk `user.deleted` webhook did it — but it depended on a webhook secret
-- being set in the host environment, and it was not: the handler was live,
-- correct, tested, and refusing every request for want of a secret nobody had
-- pasted in. `on delete cascade` needs no configuration and cannot be forgotten.

-- ---------------------------------------------------------------------------
-- Sessions
-- ---------------------------------------------------------------------------

-- One row per signed-in browser.
--
-- Rows rather than a stateless signed token (a JWT) for one reason that matters
-- more here than the convenience does: signing out, and revoking a session from
-- another device, have to actually work. A self-contained token is valid until
-- it expires no matter what the server thinks of it, so "sign out everywhere"
-- becomes a lie told with a straight face. On a ladder where the account owns a
-- rating, being able to end a session you no longer trust is not a nicety.
create table sessions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references users(id) on delete cascade,

  -- SHA-256 of the cookie value, never the value. See the note at the top.
  token_hash   bytea not null unique,

  created_at   timestamptz not null default now(),

  -- Moved forward as the session is used, so an idle session can be expired
  -- separately from an old one. A session in daily use should not be cut off at
  -- thirty days; a session last touched two months ago should not survive
  -- because it was created recently.
  last_seen_at timestamptz not null default now(),

  expires_at   timestamptz not null,

  -- Shown on the "where you're signed in" list so a person can recognise their
  -- own devices and spot one they do not recognise. Stored for that and nothing
  -- else — never used to authenticate, because both are trivially forged and a
  -- check that can be spoofed is worse than no check.
  user_agent   text,
  ip           inet
);

-- Every request that carries a cookie hits this. The unique index on
-- `token_hash` already serves the lookup; this one serves the session list and
-- the cascade.
create index sessions_user_id_idx on sessions (user_id, last_seen_at desc);

-- Expired rows are refused on read regardless — the query filters on
-- `expires_at` rather than trusting that a sweep has run — but they should not
-- accumulate forever either. This index is what makes the sweep cheap.
create index sessions_expires_at_idx on sessions (expires_at);

-- ---------------------------------------------------------------------------
-- Passkeys
-- ---------------------------------------------------------------------------

-- A registered WebAuthn authenticator: a phone, a laptop's secure enclave, a
-- hardware key.
--
-- The public key is the whole point. It is public — this table leaking tells an
-- attacker nothing they can sign with, which is the structural advantage
-- passkeys have over every password table ever breached.
create table credentials (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references users(id) on delete cascade,

  -- The authenticator's own id for this credential. Unique globally, not just
  -- per user: the same passkey must not be registrable to two accounts, or an
  -- attacker who briefly holds a device could quietly attach it to their own.
  credential_id bytea not null unique,

  -- COSE-encoded, exactly as the authenticator produced it. Stored in its
  -- original encoding rather than reshaped into something more convenient,
  -- because the signature is verified against the algorithm the key declares
  -- and re-encoding is a chance to lose that.
  public_key    bytea not null,

  -- The authenticator's own counter, which must never go backwards. A device
  -- that presents a lower count than last time has been cloned — or the vendor
  -- does not implement counters and always sends zero, which most platform
  -- authenticators do. Both cases are handled in code; the column exists so the
  -- comparison is possible at all.
  sign_count    bigint not null default 0,

  -- What the authenticator said it speaks (usb, nfc, ble, internal, hybrid).
  -- Passed back on sign-in so the browser can offer the right prompt instead of
  -- asking someone to pick.
  transports    text[],

  -- What the player calls it. Seeded from the user agent at registration and
  -- editable, because "iPhone" and "work laptop" are how people actually think
  -- about their devices.
  label         text,

  created_at    timestamptz not null default now(),
  last_used_at  timestamptz
);

create index credentials_user_id_idx on credentials (user_id, created_at);

-- ---------------------------------------------------------------------------
-- One-time links
-- ---------------------------------------------------------------------------

-- Email verification and password reset. One table, because they are the same
-- mechanism — a random token, mailed once, good for a short time, usable once —
-- and two tables would be two places to get expiry and single-use wrong.
create table email_tokens (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references users(id) on delete cascade,

  purpose      text not null check (purpose in ('verify', 'reset')),

  -- SHA-256 of the value in the link. Someone with this table cannot reset
  -- anybody's password; they hold the hash of a link, not the link.
  token_hash   bytea not null unique,

  expires_at   timestamptz not null,

  -- Set the moment it is used. Checked on redemption, so a link that lands in a
  -- mail client that prefetches URLs, or is forwarded, or is simply clicked
  -- twice, works exactly once.
  consumed_at  timestamptz,

  created_at   timestamptz not null default now()
);

-- Redemption looks up by hash (already unique). This serves the rate limit,
-- which asks how many tokens a user has been issued recently — the check that
-- stops an unbounded stream of reset mails being sent to somebody by anyone who
-- knows their address.
create index email_tokens_user_purpose_idx
  on email_tokens (user_id, purpose, created_at desc);

-- ---------------------------------------------------------------------------
-- Sign-in attempts
-- ---------------------------------------------------------------------------

-- What a rate limit is counted from.
--
-- Recorded for failures and successes alike. Counting only failures sounds
-- tidier and quietly breaks the defence: an attacker spraying one common
-- password across many accounts fails at most once per account and never trips
-- a per-account failure counter, which is precisely the attack that works
-- against a large user table.
create table auth_attempts (
  id           uuid primary key default gen_random_uuid(),

  -- The address that was tried, normalised. Not a foreign key: attempts against
  -- addresses that have no account are exactly the ones worth counting, and they
  -- must be indistinguishable from the outside — see the note in
  -- `src/lib/auth/signIn.ts` about why a wrong address and a wrong password
  -- return the same answer in the same time.
  email        text,

  ip           inet,
  succeeded    boolean not null,
  created_at   timestamptz not null default now()
);

create index auth_attempts_email_idx on auth_attempts (email, created_at desc);
create index auth_attempts_ip_idx on auth_attempts (ip, created_at desc);

-- ---------------------------------------------------------------------------
-- Deny everything
-- ---------------------------------------------------------------------------

-- As everywhere else in this schema: enabled with no policies, which denies
-- `anon` and `authenticated` outright. Supabase's linter reports
-- `rls_enabled_no_policy` on all five. That is the intended state, not a
-- finding — and on `sessions` and `email_tokens` it is the difference between a
-- leaked publishable key being an embarrassment and being every account.
alter table users         enable row level security;
alter table sessions      enable row level security;
alter table credentials   enable row level security;
alter table email_tokens  enable row level security;
alter table auth_attempts enable row level security;
