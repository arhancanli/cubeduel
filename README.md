# cubeduel

**A speedcubing platform with a rating that means something.**

[cubeduel.vercel.app](https://cubeduel.vercel.app) · 2x2 · 3x3 · 4x4 · 5x5 · no account needed to solve

The server hands you a scramble nobody has ever seen, replays your solve to prove
it happened, and only then does it count. On top of that sits the analysis a timer
normally cannot give you: every solve split into cross, F2L, OLL and PLL, so you
practise the part that is actually slow.

Solve with a keyboard, a Bluetooth smart cube, or a real cube and the spacebar.

---

## What makes it different

**The rating is not Elo.** Elo exists because chess has no absolute scale — you
only ever learn that one player beat another. Cubing has seconds. So the rating is
linear in log time, fixed to two landmarks the sport already uses:

    a 5 second average  = 3000        a 15 second average = 2000

Sub-20 is ~1740, sub-30 ~1370, a minute ~740. Every rating converts back to the
average that earned it, exactly, so the number always means something you can
picture. Details in [The rating](#the-rating-srclibratingts).

**Results are proven, not trusted.** The scramble is generated when you ask for it,
so there is nothing to cherry-pick and nothing to pre-solve. Your moves are then
replayed against that exact scramble on the server. If the cube does not end
solved, the result does not exist. See [Verification](#verification-srclibverifysolvets)
— including a precise account of what this does **not** prove.

**Failure costs certainty, not points.** A rating that ignored failed attempts
could be farmed by abandoning every solve that started badly. But rating a DNF as
a *time* means inventing a number, and a failed attempt is no evidence about speed.
So a failed average widens your margin of error and leaves the rating untouched.
Abandoning can never gain you anything.

**Duels have an opponent that cannot cheat.** Racing a bot, where the bot's
*entire trajectory* — every move and the millisecond it lands on — is written to
the database before you turn a single face. It therefore cannot speed up when it
is losing, and that is not a promise in a comment: the row is timestamped from
before the race started. Because the trajectory is fixed, it is handed to the
browser at the start and the opponent's progress renders locally from the real
move stream — no polling, no realtime channel.

The bot replays a genuine solution to the scramble you are racing, and its move
stream passes the same verifier that judges human solves. What it is *not* is a
simulated human: its solution is ~20 moves where CFOP takes 55, so it turns much
more slowly than a person would. Its time is honest; its technique is not human,
and the screen says so.

**Rush: the target tightens until you miss three.** Every other mode measures you
after the fact. This one puts a number on screen before you turn a face and
shrinks it every time you beat it, which is the situation a competition round
actually is and the one thing a timer can never reproduce. The target starts from
*your own* pace, so it is equally hard at every level — a fixed number would be a
lazy solve for somebody averaging eight seconds and unreachable for somebody
averaging forty. Nothing else in cubing has this; the closest thing anywhere is
Puzzle Rush, which is the most-played mode on chess.com.

The score is replayed on the server from the stored solves, never taken from the
browser. Each solve in a run is verified against the scramble the server issued
for it, exactly as a ranked one is — the mode is fast, but it is not less checked
for being fast.

**Four events, and a rating that means the same thing on each.** 2x2, 3x3, 4x4
and 5x5, each a separate ladder — because they are separate skills, and one
number covering a world-class 3x3 and a beginner 5x5 would describe neither. Each
event fixes its own two landmarks against real WCA results, so 3000 is world
class and 2000 is a strong club cuber whichever puzzle earned it. A single shared
scale cannot do that: the gap between a world-class 5x5 and a competent one is
nothing like the factor of three that separates them on 3x3, because much more of
a big-cube solve is mechanical work nobody can skip.

**You can challenge a real person.** Pick somebody, and you both solve the same
scramble whenever it suits you — no lobby, no waiting for two people to be online
in the same second. Two rules make it fair, and both are things the server refuses
to send rather than promises in a comment: neither of you sees the scramble until
you open your own attempt, and neither time is shown until you have both finished.
Going second is otherwise a real advantage, because knowing you need 12.40 tells
you exactly how much risk to take. Both rules were mutation-tested — each
guarantee broken in turn to confirm the suite catches it. See
[Challenges](#challenges-srclibchallengets).

**It ships its own solving engine.** Kociemba's two-phase algorithm, written from
scratch in TypeScript — cube model, coordinates, pruning tables and IDA* search.
Over 100 random-state scrambles: every cube solved, mean **20.65 moves**, median
**69ms**, all under a second. God's number is 20, so the average solution is
within a move of the proven optimum.

It is not a showpiece. It is what lets the app say *"you took 58 quarter turns;
this cube needed 20"* — a timer can tell you how long you took, but only a solver
can separate the cube being hard from you going the long way round. It is also
the prerequisite for bot opponents that replay real solutions rather than
counting down to a chosen time. The full write-up, including the three mistakes
that cost the most, is in [docs/solver.md](docs/solver.md).

**It refuses to predict.** Set a goal — sub-20, sub-15 — and the app tracks it,
which mostly means telling you that your times are *not* changing in a way that
stands out from normal variation, so there is no honest way to say when you will
get there. A projection appears only when the improvement clears twice the
standard error of the difference between halves of your history. Every other
timer fits a line through noise and reads a date off it; someone congratulated
for random drift learns the wrong lesson about whatever they changed that week.

**The trainer schedules on measured time.** No "did you get it?" button — the app
watched the cube. The bar is your own median case time, and the deck is built from
the cases your own solves produced rather than a hand-typed table of 57 algorithms.

## Running it

```bash
npm install
cp .env.example .env.local     # fill in Supabase, or leave blank
npm run dev                    # http://localhost:3000
```

**It runs with no credentials at all.** Solving, the daily, progress analysis and
the trainer are entirely local — `localStorage` is the source of truth and the app
works offline. Accounts, ranked, leaderboards and profiles need Supabase; without
it those pages say so plainly instead of breaking.

To enable them, apply everything in [`supabase/migrations/`](supabase/migrations)
to a fresh Supabase project **in filename order**, then fill in `.env.local`. All
of them are needed — `0001` is the core schema, later ones add duels, challenges
and a constraint fix — and a page whose table is missing renders a gate naming the
migration rather than an error, so a partial apply looks like a working app with
features quietly switched off.

**There is no identity provider to configure.** Accounts, sessions, passwords and
passkeys are this application's own — see [Identity](#identity-srclibauth) below.
The only optional extra is `RESEND_API_KEY` for outgoing mail; without it, links
that would have been emailed are written to the server log instead, so the whole
reset flow can be walked on a laptop with no mail provider and no domain.

## How it is tested

Four layers, because each one catches a class the others cannot. Every bug listed
in the commit history was caught by exactly one of them.

| | | |
|---|---|---|
| `npm test` | 345 unit tests | Rating maths, WCA averages, solve verification, CFOP splitting, the drill scheduler. Pure functions, no browser. |
| `npm run e2e` | 11 browser suites | Real Chromium, real keypresses, real solves. Includes a real session driving a ranked solve and a duel end to end, a passkey registered and used against Chromium's WebAuthn virtual authenticator, a phone-sized run that solves the daily by tapping and nothing else, and an accessibility pass over every page. |
| `npm run e2e:https` | 12 checks over real TLS | The two parts of authentication plain http cannot reach, and both fail silently when wrong: the `__Host-` cookie prefix, which a browser discards outright if it is not `Secure`, has a `Domain`, or is not pathed at `/`; and a relying party id derived from a real origin. Proven by breaking it — changing the cookie's path makes the browser keep no cookie at all, and the suite reports exactly that. |
| `npm run integration` | live database | The server modules against real Postgres: issues scrambles, waits out real solve durations, drives a failed rating window and a clean one. |
| `npm run integration:challenges` | live database | Head-to-head against real Postgres: two players, one scramble, both fairness rules asserted as facts — and each was mutation-tested by breaking the guarantee and confirming the suite goes red. |
| `npm run integration:rush` | live database | A whole Rush run: targets tightening, a miss costing a life, a forged solve scoring nothing, three misses ending it, and the score replayed from the stored solves rather than believed. |
| `npm run integration:events` | live database | Every event's ranked path end to end: a server-issued 4x4 scramble, solved, verified against a 4x4 and stored — plus a check that the scales really do differ, since 25 seconds is world class on 4x4 and nowhere near it on 3x3. |
| `npm run integration:profile-race` | live database | Eight concurrent first visits for the same new account, including the path where every candidate handle is taken. Exists because a new player's first page load could render "Something broke", intermittently enough to look like a fluke. |
| `npm run check:bundle` | build invariants | Two things that fail silently: future daily scrambles must not reach the client bundle, and the startup scramble pool must. |

The e2e suite exists because of one specific failure mode: an anonymous request
gets a 401 whether authentication works or is missing entirely. A suite that only
poked the API signed out would have passed while ranked was completely dead — which
it was, for a while, for two unrelated reasons. See the commit history.

```bash
npm run build && npx next start -p 3210
BASE=http://localhost:3210 npm run e2e
```

Run e2e against a **production** build, not dev — the scramble generator is a WASM
worker and the two bundlers resolve it differently.

## Stack

Next.js 16 · React 19 · TypeScript · Tailwind 4 · Supabase (Postgres) ·
[cubing.js](https://js.cubing.net) for scrambles, cube state and rendering.
The solving engine is this repository's own — see `src/lib/solver/`.

## Build gotcha: Turbopack hangs on cubing.js

`next build` with Turbopack (the Next 16 default) **hangs indefinitely** on this project —
it sits at "Creating an optimized production build" at 0% CPU and never finishes or errors.
The cause is `cubing`, whose scramble generator is a WASM web worker; in dev Turbopack
already warns that it cannot resolve the worker via `import.meta.resolve` and falls back.

`next build --webpack` compiles the same tree in ~13 seconds. The `build` script is pinned
to it. Dev stays on Turbopack, which works.

If you ever unpin this, verify the production build in a browser — a hang is obvious, but a
silently broken worker would only show up as "no scramble appears".

## The move stream — the one thing everything else is built on

Every way of solving a cube here produces the same thing: moves with timestamps,
ending in a solved state. Keyboard today, Bluetooth smart cube today, a bot replaying
a trajectory later. Everything downstream consumes that and nothing else.

```
  keyboard ─┐
            ├─► ConnectedPuzzle ─► SolveRecorder ─┬─► timer (auto start/stop)
smart cube ─┘   (move, timestamp)   + CubeStateTracker├─► solve analysis
                                                  ├─► duels
                                                  └─► coach
```

Three decisions hold this together:

**Sources report moves, never whether the cube is solved.** A keyboard puzzle starts
from a solved cube and knows nothing about the scramble we asked the player to apply,
so its own answer is the inverse of ours. `CubeStateTracker` is seeded with the
scramble instead, and every move from every source is applied to it. Solve detection
is then exact, identical across devices, and unit-testable without a browser.

**Every source is stamped with one clock.** Device timestamps differ in origin
between keyboard events and BLE packets. A solve timed on a different clock than it
is displayed on is silently wrong, so `performance.now()` is taken at handling time.

**Phases are found sequentially, after the fact.** See below.

## Phase splitting (`src/lib/cfop.ts`)

Splits a finished solve into cross, each F2L pair, OLL and PLL. This is what turns
"you took 22 seconds" into "F2L pair 3 costs you 2.1s every solve" — the only form
of feedback a cuber can act on.

Nothing hardcodes piece indices. The groups are derived from the puzzle definition by
intersecting which pieces each face turn disturbs: the DFR corner is the only corner
moved by all of D, F and R; the FR edge is the only edge moved by both F and R.

Three things that are easy to get wrong, and are covered by tests:

- **Milestones are found in order and never re-credited.** OLL and PLL algorithms
  routinely rip an F2L pair out and put it back. Scanning for the last moment each
  pair was solved would report four F2L phases during a T-perm.
- **Rotations are cancelled before every check.** Cubers rotate constantly during
  F2L; without this, "the cross edges" stop referring to the pieces actually solved
  the moment the cube is turned in their hands.
- **A milestone already standing before the first move is not a phase.** Otherwise a
  scramble that leaves the cross intact reports the whole solve as one long cross,
  and a PLL skip shows up as a phantom 0.00s phase.

Phase move counts are quarter-turn: keyboard input can only produce quarter turns, so
a half turn is two presses and is recorded as what was actually done.

## Aggregate analysis (`src/lib/phaseStats.ts`)

Per-solve splits are interesting; the aggregate is what drives practice. "OLL was slow
that time" is noise — "OLL is 43% of your solve across 60" is a training plan.

The discipline here is keeping three kinds of claim visibly separate, because it would
be easy to dress all of them up as equally solid:

1. **Arithmetic** — "OLL is 43% of your solve time over 8 solves." Indisputable.
2. **Descriptive** — "OLL is your most variable phase." True of the sample, nothing more.
3. **Interpretation** — "variable means a recognition gap." Domain reasoning, and the UI
   labels it as such under its own heading rather than letting it read as a measurement.

Rules that keep it honest:

- Nothing is claimed below a stated sample size, and the sample size appears in the claim.
- The inconsistency cut is **relative** — a phase is variable compared to that cuber's own
  other phases. There is no calibration data here to justify an absolute threshold, and
  inventing one would make a made-up number look measured.
- A trend is only called when the difference between halves exceeds twice the standard
  error of that difference. Everything inside that band reports as **no clear change**.
  A cuber congratulated for random drift learns the wrong lesson about whatever they
  changed that week. This is tested explicitly.
- DNFs and unsplittable solves are excluded from phase stats but still recorded, so the
  history doesn't quietly bias toward clean CFOP solves.

## Challenge links

`/play?scramble=...` hands a specific puzzle to a specific person — the cheapest
growth mechanic here, and the one that made TypeRacer and GeoGuessr spread. It also
means untrusted text reaches an algorithm parser, so `parseScrambleParam` validates
against a strict token allowlist and length cap first. An invalid link falls back to a
fresh scramble rather than erroring, since a mangled link should still land somewhere
usable.

## How it's put together

- `src/lib/stats.ts` — WCA averages. Trimmed ao5/ao12 (drop best and worst), one DNF is
  survivable because it trims as the worst, two are not. Averages round to the nearest
  centisecond per Regulation 9f2; single times truncate, because that is what a Stackmat
  shows and what a cuber's eye is calibrated to. Fully tested — cubers spot a wrong average
  instantly.
- `src/lib/useSpeedTimer.ts` — the start sequence as a state machine
  (`idle → holding → ready → running → stopped`). Releasing before the 300ms threshold
  cancels rather than starts, so a stray tap can't launch a solve. The running time is
  written straight to a DOM node inside `requestAnimationFrame`; a 60fps `setState` would
  re-render every frame, and the timer is the one place jank is unforgivable.
- `src/components/CubeView.tsx` — the 3D cube, via cubing.js's `TwistyPlayer`. Two cubes
  side by side, because verifying a scramble needs all six faces and a small corner inset
  reads as a stray fragment. Standard sticker colours are not a style choice: a cuber checks
  this against a physical puzzle, so they must match it. Created imperatively after a dynamic
  import so Three.js never touches the server bundle, and the scramble is pushed through the
  DOM attribute — the `experimentalSetupAlg` property is write-only and its getter throws.
- `src/lib/scramble.ts` — scramble supply in two tiers. Tier 1 is a buffer kept three deep by
  the real random-state generator, so the next scramble is in memory before the current solve
  ends. Tier 2 is a 200-scramble pool bundled with the app: the generator is a ~600KB WASM
  chunk, and waiting for it left the screen blank for **1.3s on 4G and 2.8s on 3G**. Pooled
  scrambles come from the same generator ahead of time, so the first one lands at hydration
  (**0.53s / 1.36s**) while WASM loads behind it and takes over from the second solve.
- `src/data/dailies.json` — 400 days of real random-state scrambles, generated once and
  committed. Random-state scrambles can't be reproduced from a seed, so pre-baking is what
  makes the daily byte-identical for everyone with no server and no database.
- `src/lib/daily.ts` — UTC days, so there is one global round and one reset. Share text uses
  fixed speed tiers ("sub-15", "sub-20") rather than a percentile, because a percentile would
  need a population that doesn't exist yet and inventing one would make the share a lie.

## Build invariants

`npm run check:bundle` guards two things that fail silently:

- **Future daily scrambles must not reach the client bundle.** `dailies.json` holds over a
  year of scrambles and is imported only from the server component at `src/app/daily/page.tsx`,
  which forwards a single day. If a client component ever imports it, tomorrow's daily becomes
  readable in devtools and can be practised in advance — the daily stops being a contest, and
  nothing about the UI would look wrong.
- **The startup scramble pool must reach the client bundle.** If it stops being bundled the
  app still works and only gets quietly slower, which is the kind of regression nobody notices.

## The platform

Everything above works signed out and offline. Everything below needs an account,
because it makes a claim about a person that has to persist.

**Nothing in the browser writes to the database.** Every table has RLS enabled with
no policies at all, which denies the anon and authenticated roles outright. Writes
happen only in server code that has already checked the session cookie and, for anything
ranked, re-verified the result itself. A rating the client can PATCH is not a rating.

### The rating (`src/lib/rating.ts`)

Deliberately not Elo. Elo exists because chess has no absolute scale — you only
learn that one player beat another. Cubing has seconds, so the rating is a log-time
scale fixed to two landmarks the sport already uses:

    a 5 second average  = 3000
    a 15 second average = 2000

Sub-20 is ~1740, sub-30 ~1370, and the floor of 100 lands near two minutes. The
transform is exact and invertible, so every rating can be shown next to the time it
means. It also has a **ceiling**: the log runs to infinity as time approaches zero,
and without one a single corrupt 0ms record rated five figures and sat permanently
at the top of every board.

The unit is a window of five ranked attempts averaged by WCA rules — the same
trimmed ao5 as `stats.ts`, because there should be exactly one definition of
"average" in this app.

**DNFs are uncertainty, not a penalty.** A rating that ignored failed attempts could
be farmed by abandoning every solve that started badly. But rating a DNF as a *time*
means inventing a number, and a failed attempt contains no evidence about speed. So
a DNF ao5 leaves the rating untouched and widens the deviation. Abandoning can never
raise a rating, and repeated failure widens the deviation until the player drops off
the leaderboard for being unestablished. No fabricated time appears anywhere.

### Challenges (`src/lib/challenge.ts`)

One player against another, on the same scramble. Asynchronous on purpose: a live
race needs two people online in the same second, and a ladder that only works at
peak concurrency does not work at all for whoever shows up at 2am. A challenge
sitting in an inbox is also the strongest reason an asynchronous game has to bring
someone back — chess.com's daily games have outlived every real-time lobby that
came and went around them.

Two rules make it fair, and both are enforced by what the server refuses to send:

**Neither player sees the scramble until their own attempt opens.** The challenger
picks an opponent, not a scramble. If they could see it at creation they could
study it and pick their moment; if the opponent could read it while it sat in
their inbox they could study it for two days. Opening your half stamps a time that
is never moved, so closing the tab and coming back does not buy a fresh fifteen
seconds of inspection.

**Neither time is shown until both have solved.** Going second is otherwise a real
advantage — knowing you need 12.40 tells you exactly how much risk to take, and a
solve attempted at a known target is not the same event as one attempted blind.

Both are decided in one place (`visibleTo`) that every read goes through, because
a rule enforced separately in four route handlers is enforced in three of them.
And both were mutation-tested: breaking each guarantee in turn and confirming
`npm run integration:challenges` goes red, because a fairness check that cannot
fail is worse than none.

Expiry is judged on read rather than by a scheduled job — there is no cron here,
and a status column that is only correct when something remembered to run is worse
than no column. A challenge that lapses with one side solved is a win for the
player who turned up: the alternative is that ignoring a challenge you are losing
costs nothing, and every inconvenient challenge quietly evaporates.

Challenges do not move your rating, for the same reason bot duels do not: how fast
you solve does not depend on whether somebody is racing you.

### Inspection (`src/lib/inspection.ts`)

WCA gives fifteen seconds to look at the cube before starting: over that is +2
(A4b1), over seventeen is a DNF (A4b2), with spoken warnings at 8 and 12 seconds.
Ranked enforces all of it.

**The server measures it, and it has to.** A client-reported figure cannot work —
the penalty only ever hurts, so there is a standing incentive to under-report, and
nothing in the move stream reveals how long somebody stared at the cube beforehand.
What the server does know is when it issued the scramble and, from the move
timestamps, when the first turn happened. Inspection is the gap between them. That
is both measurable from the server's own clock and faithful to the real rule, where
inspection starts the moment you are allowed to look.

A fixed 1.5s allowance is deducted before judging, because the server starts
counting when it *sends* the scramble and the player cannot look until it arrives
and paints. Being generous there is deliberate: a +2 nobody earned is far worse
than a +2 somebody escaped, because the first makes the ladder feel arbitrary and
the second costs almost nothing.

The countdown on screen and the final verdict come from the same module, and a test
pins them to each other at every boundary — a clock that says "+2" and then does not
charge it is worse than showing no clock at all. `npm run integration` sits on a
scramble past the limit and asserts the server applies a DNF the client never sent:
a rule that is correct, unit-tested and never actually executed is not a rule.

### Does a human look like this? (`src/lib/humanness.ts`)

Verification proves a move stream really solves the scramble it was issued for.
It cannot prove a person produced it: a program that solves the cube and replays
the answer at a believable speed passes every check in `verifySolve.ts`, and
always will. This layer looks at *how* the moves arrived instead.

**Move count** is the strongest signal, because the obvious cheat is to replay an
engine's answer and an engine's answer is 20 moves. A human solving 3x3 with CFOP
takes around 55; under about 30 while racing a clock is not a talented person, it
is a search.

**Pauses** are the second. People stop — to find the next pair, to recognise the
last layer — and those stops are long relative to their turning. A replayed
solution has no reason to pause, so its gaps cluster tightly around one value.

**Rhythm** is the third. Even mid-burst, human turning wanders: fingers, grip
changes, a cube that catches. Perfectly even spacing is a metronome, and a
metronome is the cheapest cheat to write.

The score is the *worst* signal rather than the average, because these are
alternative ways of being impossible rather than parts of one measurement — a
twenty-move solve is damning whatever its rhythm looked like, and averaging would
let three ordinary signals dilute one that is conclusive.

**Nothing is acted on automatically, and that is deliberate.** Every signal has a
false-positive story: a short solve happens when the scramble is kind, a low-pause
solve happens on a case somebody has drilled a thousand times. The cost of being
wrong is asymmetric — a missed cheat costs one rating, a wrongly banned player
costs the belief the whole ladder runs on. So the score is stored for review, the
threshold is set high, and a *run* of flagged solves from one account is the
question worth asking rather than any single one.

The test that matters most is that it flags this repository's own integration
harness, which paces solves evenly by inverting the scramble — exactly the shape a
replayed answer has. A detector that could not see that could not see the real
thing either.

### Identity (`src/lib/auth/`)

Accounts, sessions, passwords and passkeys are this application's own. There is
no identity provider, and every line of it is in this repository.

It was rented before, and the reasons for moving are worth stating plainly: the
development instance capped at a hundred users, its sign-up form began rendering
a CAPTCHA that the project's own test suite could not solve — which read exactly
like the app being broken — and the account-deletion webhook was live, correct,
tested, and refusing every request because a secret was never set in the host
environment. The most load-bearing question in the product is *is this really the
person whose rating this is*, and it should not be answered by something that
cannot be tested end to end.

**Nothing cryptographic is invented.** Passwords use scrypt from `node:crypto`;
signatures are verified by OpenSSL through the same module. Writing an
authentication layer by hand is reasonable and this repository does it
deliberately — writing a *hashing scheme* by hand is not, and the distinction is
why `password.ts` is short and boring.

scrypt runs at `N = 2^15, r = 8, p = 3`, one of the configurations OWASP lists
and specifically the one for environments short on memory rather than CPU. That
is this one: memory is spent per concurrent hash, so the headline `N = 2^17`
would ask 128 MiB each and exhaust a serverless function before it ran out of
time. Measured on the machine that wrote this, not estimated — 107 ms at 32 MiB
against 151 ms at 128 MiB.

**Sessions are rows, not signed tokens.** A self-contained token stays valid
until it expires no matter what the server thinks of it, which makes "sign out
everywhere" a lie told with a straight face. On a ladder where the account owns
a rating, ending a session you no longer trust is not a nicety. Both expiry
rules — thirty days absolute, seven days idle — are enforced on read rather than
delegated to a sweep, because a cleanup job that fails silently must not quietly
extend everybody's session.

**Nothing replayable is stored.** Session cookies and email links are 256-bit
random values held by the client; the columns hold their SHA-256. A full dump of
`sessions` grants nobody a session. Passwords are the opposite case and get the
opposite treatment.

### Passkeys (`src/lib/auth/webauthn.ts`)

The CBOR decoder, the COSE key handling and both WebAuthn ceremonies are written
out rather than installed, for the same reason as everything else here: the code
standing between an attacker's bytes and a public key is exactly the part an
auditor wants to see. The CBOR decoder is tested against RFC 8949's own vectors,
not fixtures it produced itself.

Three decisions carry most of the weight:

**The algorithm comes from the stored credential, never from the assertion being
verified.** A verifier that reads it out of the message lets the attacker choose
it, which is the shape of the `alg: none` JWT bypasses that broke a long list of
libraries that all looked correct.

**Origins are compared for equality, never with `startsWith`.**
`https://cubeduel.vercel.app.attacker.com` starts with the expected origin, and a
passkey usable from an attacker's page is not a passkey.

**The signature counter is advisory.** Every synced passkey — iCloud Keychain,
Windows Hello, Google Password Manager — reports zero forever, so a decrease only
means anything when both sides are non-zero. Treating zero as a clone would lock
out most real users.

Attestation statements are deliberately **not** verified, and that is written
down rather than left as a silence: "we verify the attestation object" and "we
verify attestation" sound alike and are very different claims. Checking them
means shipping vendor root certificates to buy the ability to refuse somebody's
perfectly good phone.

`testAuthenticator.ts` is a working software authenticator holding a real P-256
key, and it can be told to lie — wrong challenge, wrong origin, wrong relying
party, no user presence, a counter wound backwards. That is what makes the
rejection paths testable, which is the half of a security check that normally
goes untested. `e2e/auth.py` then does the same thing through Chromium's own
WebAuthn virtual authenticator, which catches the class of bug no unit test
reaches: the `ArrayBuffer` that `JSON.stringify` silently turns into `{}`.

### Verification (`src/lib/verifySolve.ts`)

The server issues the scramble, so there is nothing to cherry-pick and nothing to
pre-solve. It then replays the submitted move stream against **that** scramble and
checks the cube ends solved. KPuzzle runs in Node in single-digit milliseconds, and
`cubeReplay.ts` is shared with the browser so the two can never disagree about what
"solved" means.

Be precise about what this proves. **Proved:** the moves genuinely solve the exact
scramble issued, the attempt is single-use, and the claimed time is consistent with
the move timestamps and the server's own clock. **Not proved:** that a human did it.
A program solving at a plausible turn rate would pass. That is the same position
chess sites are in with engines, and it is answered by behavioural analysis across
many results — a layer that does not exist yet.

The checks are tuned to be *specific*, never rejecting an honest solve, rather than
sensitive. A false rejection costs a real player a real result, which is worse than
letting a determined cheat through to be caught by their record. A world-record 11
turns-per-second solve verifying is an explicit test.

Opening a new ranked attempt closes any open one as a DNF. Without that, "start
again when it goes badly" is a free reroll — the same exploit as farming DNFs
wearing a different hat.

### The trainer (`src/lib/trainer.ts`)

Spaced repetition was designed for recall: did you remember, yes or no. Algorithm
drilling is not that — a cuber always "remembers" a T-perm, and what is being
trained is recognition speed and execution. So the signal is **time**, and there is
no button for the learner to lie to.

The bar is that cuber's own median case time, not an absolute: "as fast as you
already are at most things". A fixed threshold in seconds would tell a 40-second
beginner they are failing at everything. Intervals are counted in reps rather than
days, because days are useless inside a twenty-minute session.

The deck is built from cases the cuber's own solves produced, using setups already
recorded with each solve. A canned table of 57 hand-typed algorithms would be 57
chances to teach someone the wrong finger trick; a small starter set whose
algorithms verify against their own signatures seeds a deck with no history yet.

An OLL rep ends the moment the last layer is **oriented**, not when the cube is
solved — otherwise every OLL time would silently include a PLL, and every schedule
decision after that would be made on a number measuring the wrong thing. `e2e/train.py`
drives this in a real browser.

### Duels (`src/lib/server/duels.ts`)

Racing a bot, with one decision holding it up: the opponent's **entire
trajectory** — every move and the millisecond it lands on — is written to the
database before the player turns a single face. It cannot speed up when it is
losing, and that is checkable rather than promised: the row is timestamped from
before the race began. Rubber-banding is the usual way racing games lie, and an
app claiming its ratings mean something cannot also do that.

Committing the trajectory also removes the need for realtime entirely. It is
handed to the browser at the start, so the opponent's progress renders locally
from the real move stream — no polling, no live channel, which is what made this
shippable on a deny-all architecture.

The bot replays a genuine solution to the scramble being raced, and its move
stream passes the same verifier that judges human solves. It is **not** a
simulated human: the engine finds ~20 moves where CFOP takes 55, so it turns far
more slowly than a person to hit the same time. Its time is honest and its
technique is not, and the screen says exactly that.

Duel results deliberately do not move the rating. You solve at the same speed
whether or not somebody is racing you, so a second path to the same number would
double the ways to move it without adding information.

### Goals and the coach (`src/lib/coach.ts`)

Set a target and the app tracks it, which mostly means refusing to predict. A
projection appears only when the improvement clears twice the standard error of
the difference between halves of the history; everything inside that band reports
as **no clear change**. Every other timer fits a line through noise and reads a
date off it, and someone congratulated for random drift learns the wrong lesson
about whatever they changed that week.

The plan ranks cases by the time they would give back **per solve** — `excessMs`
is a total across the whole sample, and quoting it directly would overstate the
benefit by the size of that sample — then says plainly when algorithms cannot
close the gap: *"roughly 40% of the 2.6s you need; the rest has to come from
turning faster or pausing less."*

## Not built yet

- **Live real-time races.** Head-to-head works asynchronously (see Challenges);
  watching an opponent's bar move in the same second needs matchmaking and a live
  channel, and needs a population before it needs code. The `challenges` row is
  shaped for it: both sides are symmetric and independently timestamped, so live
  is the case where the two `started_at` values happen to coincide.
- **Acting on the humanness score.** Every verified solve is now assessed and the
  score stored (see below), but nothing consults it automatically. Turning a
  statistic into a ban needs a review process and an appeal, and shipping the
  enforcement before those exist would be the wrong order.
- **Smart cubes are still unverified against hardware.** The Bluetooth path is written
  and typechecked but has never been run against a GAN/GoCube/GiiKER. Treat it as
  unproven until it is. The `smartcube` rating pool exists and is deliberately separate
  from `keyboard` — they are different sports with different time scales.
- **Elo-gated cube skins.** Cosmetic only. Anything that gates function behind rating
  turns a skill ladder into a paywall with extra steps.

---

## Contributing

Issues and pull requests are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).
It is short, and specific about the two rules that actually govern changes here:
explain *why* rather than *what*, and never make a claim the code cannot support.

Security reports go through [Security Advisories](../../security/advisories/new),
not public issues — see [SECURITY.md](SECURITY.md). Note that **anything letting a
rating be obtained without earning it is treated as a vulnerability**, not a
gameplay bug.

## Licence

[GNU AGPL-3.0-only](LICENSE). Copyright (c) 2026 Arhan Canli.

Free to use, study, modify and share. The one obligation that matters: if you run
a modified version **as a network service**, you have to publish your changes
(§13). Ordinary use, self-hosting and contribution are unaffected — the clause
exists so improvements to a public ladder stay public.
