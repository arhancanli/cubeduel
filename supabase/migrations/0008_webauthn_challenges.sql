-- The challenges behind every passkey ceremony.
--
-- A WebAuthn ceremony is a signature over a value the server chose. That is the
-- entire anti-replay mechanism: without it, one captured assertion signs in
-- forever, because the assertion is otherwise identical every time.
--
-- So the value has to be *ours*. It is generated here, stored here, and matched
-- here — never taken from a cookie, a request field, or anything else the
-- client can choose. A challenge the client supplies is a challenge the attacker
-- supplies, and a signature over an attacker-chosen value proves nothing about
-- when it was made.
--
-- ============================================================================
-- Single use, and why it is a delete rather than a flag
-- ============================================================================
--
-- Consuming a challenge deletes the row and returns it in one statement, so two
-- requests racing the same challenge cannot both find it valid. A `consumed_at`
-- flag would need a read, a decision and a write, and the window between them is
-- precisely where a replay lives.
--
-- `email_tokens` uses the flag approach instead, deliberately: a person clicking
-- a verification link twice should be told "already verified" rather than
-- "invalid link", which needs the row to still exist. Here nobody ever sees the
-- challenge, so there is nothing to explain and nothing to keep.

create table webauthn_challenges (
  id             uuid primary key default gen_random_uuid(),

  -- SHA-256 of the base64url challenge, for consistency with every other token
  -- column in this schema.
  --
  -- Stated plainly: the security benefit here is smaller than it is for sessions
  -- or email links. The challenge is sent to the browser in the clear — it has
  -- to be, it goes into the credential options — so it is not a secret, and an
  -- attacker holding one still cannot produce a signature without the private
  -- key. It is hashed because a uniform rule ("no token is stored in the form it
  -- was issued") is easier to hold to than a rule with exceptions, and because
  -- it costs nothing.
  challenge_hash bytea not null unique,

  purpose        text not null check (purpose in ('register', 'authenticate')),

  -- Null for a sign-in with a discoverable credential, where the whole point is
  -- that the server does not yet know who is at the keyboard — the authenticator
  -- reveals that by returning a user handle. Set when adding a passkey to an
  -- account that is already signed in, so that a challenge issued for one person
  -- cannot be completed by another.
  user_id        uuid references users(id) on delete cascade,

  expires_at     timestamptz not null,
  created_at     timestamptz not null default now()
);

-- Rate limiting reads this: how many ceremonies has this account started
-- recently. Without a cap, the start endpoint is an unauthenticated way to
-- insert rows forever.
create index webauthn_challenges_user_idx
  on webauthn_challenges (user_id, created_at desc);

-- Makes the sweep cheap. Nothing depends on the sweep having run — expiry is
-- enforced on read — but the table should not grow without bound.
create index webauthn_challenges_expires_idx on webauthn_challenges (expires_at);

alter table webauthn_challenges enable row level security;

-- ---------------------------------------------------------------------------
-- Credential labels
-- ---------------------------------------------------------------------------

-- Which algorithm a credential's key uses, recorded at registration.
--
-- The verifier already reads this out of the stored COSE key, so this column is
-- not consulted when checking a signature — putting it on the write path would
-- be the algorithm-confusion mistake with extra steps, since the authority has
-- to be the key itself.
--
-- It exists so that "which of my passkeys are on which algorithm" is a query
-- rather than a decode of every row, which matters the day one of these needs
-- retiring.
alter table credentials add column if not exists algorithm integer;

-- Whether the credential syncs between the person's devices, as the
-- authenticator reported at registration.
--
-- Worth showing them. A synced passkey survives losing the phone; a
-- device-bound one does not, and somebody whose only credential is device-bound
-- should be told to add a second before they find out the hard way.
alter table credentials add column if not exists backed_up boolean;
