# Contributing

Issues and pull requests are welcome. This file is short on ceremony and specific
about the two things that actually matter here.

## Run the checks

```bash
npm install
npm run typecheck
npm run lint
npm test
npm run build && npm run check:bundle
```

CI runs exactly these on every pull request. The browser and database suites
(`npm run e2e` and the three `integration` scripts) need a running server and
real credentials,
so they are not in CI — run them locally if you touch the solve loop, the ranked
path, or anything that talks to Postgres.

## The two rules

**1. Say why, not what.** The code is read far more often than it is written, and
the expensive knowledge here is never *what* a line does — it is which wrong
version was tried first. A comment that says `// increment the counter` is noise.
A comment that says why the counter cannot be reset on a failed window is the
reason the next person does not reintroduce a bug.

Look at any file in `src/lib/` for the house style. The bar is: someone changing
this in a year should be able to tell, from the code alone, what breaks if they
change it back.

**2. Never make a claim the code cannot support.** This project is unusually
strict about honesty in what it tells a player, and that is deliberate — the whole
proposition is a rating people believe.

Concretely:

- No statistic below a stated sample size. `/progress` refuses to name a weakness
  from one solve, and says so.
- A change inside normal variation is reported as **no change**, not as progress.
- Nothing invents a number. A failed rating window produces no rating, because a
  failed attempt is no evidence about speed — it widens the margin of error
  instead. A `NOT NULL` column once turned that into a stored rating of `0`, which
  is a number nobody earned appearing on a public profile.
- Verification proves a solve is *real*, not that a *human* did it. The code says
  so rather than implying it is cheat-proof.

If a change makes the app assert something it cannot demonstrate, it will be sent
back even if the code is correct.

## Tests

Bug fixes need a test that fails without the fix. Pick the layer that would have
caught it:

- **Unit** (`src/lib/*.test.ts`) — pure logic. Fast, no browser, no network.
- **Browser** (`e2e/*.py`) — anything a user does with their hands. Playwright.
- **Integration** (`scripts/integration-ranked.mts`) — anything that crosses into
  Postgres.

Two real examples of why the layer matters. A drill that recorded a time but
displayed `0.00` passed every unit test — only the browser suite saw it. A ranked
submission that failed because `performance.now()` is fractional and the column is
an integer passed the integration test too, because the test sent whole numbers;
it now sends a fractional duration on purpose.

## Commits

Explain the reasoning, not the diff. `git log` here is a design record, and it is
meant to be readable on its own.
