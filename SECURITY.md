# Security

## Reporting

Please report vulnerabilities privately through
[GitHub Security Advisories](../../security/advisories/new) rather than opening a
public issue.

Include what you did, what happened, and what you expected. A proof of concept is
welcome; please do not run it against other people's accounts or ratings.

## What counts as a vulnerability here

Beyond the usual, this project has a category most apps do not: **anything that
lets a rating be obtained without earning it.** The ladder is the product, so that
is treated as a security issue, not a gameplay bug.

That includes being able to:

- move a rating without a verified solve
- submit a solve for a scramble the server did not issue to you
- reuse or replay a spent attempt
- make an abandoned or failed attempt cost nothing
- read the scramble pool, another player's pending attempt, or any table directly

Two real examples, both already fixed, to show the kind of thing that qualifies:

- `REVOKE EXECUTE ... FROM public` on the rating function did **not** stop `anon`,
  because Supabase's default privileges grant those roles their own EXECUTE at
  creation. A request carrying only the publishable key reached the function body
  and was stopped one layer later by row-level security. Nothing was exposed, but
  the revoke was decorative.
- A failed first rating window stored a rating of `0` — below the scale's floor of
  100 — because the column was `NOT NULL` and there was no rating to store.

## Design, so you know where to look

- **Every table has RLS enabled with zero policies.** `anon` and `authenticated`
  are denied outright. There is no public read or write path to the database.
- **All writes go through server code** holding the service-role key, after
  checking authentication and, for anything ranked, re-verifying the solve.
- **Ranked scrambles are generated per request** and stored server-side. The
  submitted move stream is replayed against the stored scramble, never against one
  the client sends.
- **Attempts are single-use**, expire, and are recorded as a DNF if abandoned.

## What is knowingly not solved

Stated plainly because pretending otherwise would be the actual risk.

**Verification proves a solve is real. It does not prove a human did it.** A
program solving the issued scramble at a plausible turn rate, with plausible
pauses, passes every check. This is the same position chess sites are in with
engines, and it is answered the same way — behavioural analysis across many
results, not a check on any single one. That layer does not exist yet.

Reports of *engine-like* play are therefore expected to be about detection
strategy rather than a bug. They are still welcome.
