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

Head-to-head challenges add two more, because both are advantages that cannot be
earned by solving faster:

- **reading a challenge scramble before your own half is open.** Both players are
  supposed to see it for the first time when their attempt starts. Anything that
  reveals it earlier — the API, a page's initial props, a cached response — hands
  one player study time the other did not get.
- **reading the other player's time before you have both finished.** Knowing you
  need 12.40 tells you exactly how much risk to take, so a solve attempted at a
  known target is not the same event as one attempted blind.

Both are decided in one place (`visibleTo` in `src/lib/challenge.ts`) that every
read goes through, and both are mutation-tested in
`scripts/integration-challenges.mts` — each guarantee is broken in turn to confirm
the suite catches it. If you find a path around that function, it is a report.

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
- **Opening your half of a challenge stamps a time that is never moved**, so
  closing the tab and returning does not buy a fresh fifteen seconds of inspection.

## What is knowingly not solved

Stated plainly because pretending otherwise would be the actual risk.

**Verification proves a solve is real. It does not prove a human did it.** A
program solving the issued scramble at a plausible turn rate, with plausible
pauses, passes every check. This is the same position chess sites are in with
engines, and it is answered the same way — behavioural analysis across many
results, not a check on any single one. That layer does not exist yet.

Reports of *engine-like* play are therefore expected to be about detection
strategy rather than a bug. They are still welcome.
