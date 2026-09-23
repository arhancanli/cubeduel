# cubeduel

**A speedcubing platform with a rating that means something.**

[cubeduel.vercel.app](https://cubeduel.vercel.app) · 2x2 · 3x3 · 4x4 · 5x5 · no account needed to solve

The server hands you a scramble nobody has ever seen, replays your solve to prove
it happened, and only then does it count. On top of that sits the analysis a timer
normally cannot give you: every solve split into cross, F2L, OLL and PLL, so you
practise the part that is actually slow.

Solve with a keyboard, a Bluetooth smart cube, or a real cube and the spacebar.

![The analysis page: F2L is 54% of your solve across 64 solves, with a per-phase
breakdown and the cases worth drilling](docs/screens/progress.png)

<sub>The part no other cubing site can do: your solve split into phases, ranked
by the time you would actually get back.</sub>

---

## If you only read one section

Three things here are unusual enough to be worth naming before the feature list.

**A cube solver written from scratch.** Kociemba two-phase, searching every cube
from six sides at once, no solver library: 18.93 moves on average at the server's
settings with a 27ms median, or an 8ms median at the quicker default — short
routes, not proven-shortest ones (a random cube's true minimum averages about
17.7). Phase one knows the exact distance to its goal for all 141 million
positions, which is 2.2 billion folded down by the cube's own symmetry. It powers
the move efficiency figure — *you used 52 moves; the engine's route was 20* — and
the duel opponent. [How it works](docs/solver.md), including the pruning-table
mistake that quietly turned the search into brute force, and the 40× cold start
fix.

**Results are proven rather than trusted.** The server generates the scramble,
stores it, and replays your move stream against it. If the cube does not end
solved, the result does not exist. The [security notes](SECURITY.md) say plainly
what this does *not* prove, and a behavioural layer scores every solve for how
human it looked without acting on it.

**Identity is this project's own** — sessions, passwords and passkeys, including
a hand-written CBOR decoder and both WebAuthn ceremonies, tested against RFC
8949's own vectors and against Chromium's virtual authenticator. Nothing
cryptographic is invented; the primitives are `node:crypto`.

And a working habit that shows up throughout: **a check is not trusted until it
has been made to fail.** Roughly fifty mutation tests in the history, each one a
deliberate reintroduction of the bug the check exists for. Several of those
found the check could not fail at all.

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
Over 200 uniformly random states at the server's settings: every cube solved,
mean **18.93 moves**, median **27ms**, nothing over 451ms — searching each cube
from six sides at once (turned about its diagonal, and inverted), never
re-solving the same phase two twice, and looking up how far phase one really is
from its goal rather than guessing. That last one is a table of 141 million exact
distances: all three phase-one coordinates at once would be 2.2 billion, and the
sixteen symmetries that leave the up-down axis alone fold them into 67MB, built
in eleven seconds. It cut phase one from 773 million search nodes across sixty
cubes to 118 million.
Those routes are short, not proven shortest: a random cube's true minimum is 17
or 18 moves about 95% of the time, so the engine runs a little over a move long,
and the app says "the engine's route", never
"the shortest possible". Earlier versions of this README said the average was
"within a move of the proven optimum", comparing it with God's number — which is
the worst case, not the typical one.

It is not a showpiece. It is what lets the app say *"you used 52 moves; the
engine's route was 20"* — a timer can tell you how long you took, but only a solver
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

For development, `npm run db:up` gives you all of it with no account anywhere:
a local Postgres with every migration applied, served the way Supabase serves it.
`node scripts/db-local.mjs run -- npm run dev` points the app at it. Needs Docker.

To run against a hosted project instead, apply everything in [`supabase/migrations/`](supabase/migrations)
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
| `npm test` | 730 unit tests | Rating maths, WCA averages, solve verification, CFOP splitting, the drill scheduler. Pure functions, no browser. |
| `npm run e2e` | 25 browser suites | Real Chromium, real keypresses, real solves. Includes a real session driving a ranked solve and a duel end to end, a passkey registered and used against Chromium's WebAuthn virtual authenticator, a phone-sized run that solves the daily by tapping and nothing else, an accessibility pass over every page, the link previews fetched the way a chat app fetches them, and a solve built with two known faults that the review has to find. |
| `npm run audit` | the repository's own claims | Every internal link has a page, every fetched API path has a route, every analytics event has an emitter, every path the docs name exists, every suite is wired up, and the counts in this table are the counts the runner reports. Exists because all six were wrong at some point while everything compiled and every test passed. |
| `npm run e2e:https` | 12 checks over real TLS | The two parts of authentication plain http cannot reach, and both fail silently when wrong: the `__Host-` cookie prefix, which a browser discards outright if it is not `Secure`, has a `Domain`, or is not pathed at `/`; and a relying party id derived from a real origin. Proven by breaking it — changing the cookie's path makes the browser keep no cookie at all, and the suite reports exactly that. |
| `npm run integration:local` | 12 integration suites | A fresh local Postgres with every migration applied, then every `scripts/integration-*.mts` against it — found by filename, so a new suite runs the moment it exists. Refuses to touch a hosted database unless told to. The rows below are the suites. |
| `npm run integration` | local Postgres | The server modules against real Postgres: issues scrambles, waits out real solve durations, drives a failed rating window and a clean one. |
| `npm run integration:challenges` | local Postgres | Head-to-head against real Postgres: two players, one scramble, both fairness rules asserted as facts, and a third player racing for the same open seat — one accept lands, the other is refused, the board drops the row, and the scramble stays hidden through all of it. Each guarantee was mutation-tested by breaking it and confirming the suite goes red. |
| `npm run integration:rush` | local Postgres | A whole Rush run: targets tightening, a miss costing a life, a forged solve scoring nothing, three misses ending it, and the score replayed from the stored solves rather than believed. |
| `npm run integration:events` | local Postgres | Every event's ranked path end to end: a server-issued 4x4 scramble, solved, verified against a 4x4 and stored — plus a check that the scales really do differ, since 25 seconds is world class on 4x4 and nowhere near it on 3x3. |
| `npm run integration:profile-race` | local Postgres | Eight concurrent first visits for the same new account, including the path where every candidate handle is taken. Exists because a new player's first page load could render "Something broke", intermittently enough to look like a fluke. |
| `npm run integration:accounts` | local Postgres | Sessions resolved and revoked, both expiry rules, a reset link that works exactly once and signs every device out — and none of it telling an outsider whether an address has an account. |
| `npm run integration:passkeys` | local Postgres | A challenge redeemed exactly once, never across accounts, the sign-in counter persisted, and an account unable to delete its own only way in. |
| `npm run integration:clubs` | local Postgres | A club board reads the same verified ratings the global one does, and lists members with no rating rather than hiding them. |
| `npm run integration:wca` | local Postgres | The OAuth state is issued here, redeemed once, and bound to the profile that started it — the only thing between an honest link and somebody attaching a world-class average to their name. |
| `npm run integration:solve` | local Postgres | A solve permalink says the same thing a fortnight later: faster solves added afterwards must not rewrite its verdict. |
| `npm run integration:sync` | local Postgres | Practice solves keep their move stream, and the stored breakdown, cases and counts are derived from it — a request that lies about any of them changes nothing stored. A stream longer than its own solve is dropped, and junk never reaches the splits column. |
| `npm run integration:race` | local Postgres | A whole live race between two players: one seat taken once and never by a third, the scramble existing through the countdown and sent to neither player until the start, both pressing ready at once starting it exactly once, a forged solve becoming a DNF, the server's winner, and a rematch that lands both players in the same new race. |
| `npm run verify:tables` | 141 million distances | The generated phase-one table against an independent search: its distance is the true shortest for random positions, the same position mirrored or turned is the same distance away, every entry was reached, the hardest needs twelve moves, and solving with it visits less than half the nodes. Its numbers are believed completely by the search — one too high and the branch holding the shortest solution is cut, silently — so deleting a rule from the fill and rebuilding is checked to make it go red. |
| `npm run check:bundle` | build invariants | Two things that fail silently: future daily scrambles must not reach the client bundle, and the startup scramble pool must. |

The e2e suite exists because of one specific failure mode: an anonymous request
gets a 401 whether authentication works or is missing entirely. A suite that only
poked the API signed out would have passed while ranked was completely dead — which
it was, for a while, for two unrelated reasons. See the commit history.

```bash
npm run e2e:local      # needs Docker
```

That is the whole thing in one command: a fresh local database, a production
build, a server on `http://localhost:3000` pointed at that database, every suite,
and the server stopped afterwards. No credentials, and nothing it creates lands
anywhere real.

Two constraints it encodes, both learned the hard way. Run e2e against a
**production** build, not dev — the scramble generator is a WASM worker and the two
bundlers resolve it differently. And serve it on the origin it was **built for**:
passkeys and emailed links are bound to `NEXT_PUBLIC_SITE_URL`
(`http://localhost:3000` when unset), so the same suites against a server on any
other port fail sign-in for reasons that have nothing to do with the code. The
instructions here used to say port 3210, which is how that was found.

## Stack

Next.js 16 · React 19 · TypeScript · Tailwind 4 · Supabase (Postgres) ·
[cubing.js](https://js.cubing.net) for scrambles, cube state and rendering.
The solving engine is this repository's own — see `src/lib/solver/`.

## The Node version is worth 3.4x

Pinned to `>=22` in `engines`, and the reason is measured rather than
precautionary. The solver on 200 uniformly random states:

| runtime | median | mean | p95 |
|---|---|---|---|
| Node 20 | 55.2ms | 91.9ms | 251ms |
| Node 24 | 16.2ms | 40.0ms | 162ms |

251ms on Node 20 is not slowness, it is the `timeBudgetMs` cutoff: more than 5%
of solves exhausted their budget and returned best-so-far instead of the answer
they were looking for. On Node 24 about 1% do.

Nothing pinned this until now, which meant a change to a hosting platform's
default runtime could have quietly tripled the search time and shortened the
solutions, with no failing test anywhere to say so.

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

## Looking and turning (`recognitionMs`, `lookAndTurn`, `explainSlowSolves`)

The question every cuber asks and no stopwatch can answer: *am I slow because I
cannot see what to do, or because I cannot do it?* The move stream answers it by
measurement. A phase starts where the previous one's last turn landed, so every
phase already contained its own looking; it was just never separated out.
`recognitionMs` is the time before a phase's first **turn** — between F2L pairs,
and recognising the OLL and PLL case — and the rest is turning.

- **A rotation is looking, not turning.** Bringing a pair round to look at it is
  part of seeing what to do, so recognition ends at the first layer turn, not the
  first move. Tested by rotating away and back inside a pause and asserting the
  pause is unchanged.
- **The cross has none inside the clock.** The clock starts on the first turn, so
  its looking is inspection. Showing "0.0s looking" would be true and misleading, so
  the cross is left out rather than displayed.
- **"Hands" is turning speed with the pauses taken out.** Ordinary TPS mixes the
  two, which is how a cuber with fast hands and slow eyes reads as "low TPS" and
  goes off to practise fingertricks they do not need.

The diagnosis on `/progress` now **measures** where a phase's time goes instead of
inferring it from variance. It does not compare looking against turning — turning
is the larger part for almost everyone, so that comparison would say "execution"
whatever the truth was. It ranks the cuber's own solves by that phase, splits them
in half, and asks which part the extra time in the slower half went to: *"In your
slower half of 40 solves, F2L takes 2.6s longer: 2.1s more between pairs, 0.5s
more turning."* Only the cuber's own solves, no population norm, and no threshold
for "too much looking" — there is no data here to set one honestly. Below ten
measured solves it falls back to the spread heuristic and says nothing measured.

`e2e/looking.py` types a CFOP solve on the keyboard with a 1.2s pause before one
F2L pair and asserts the pause lands in exactly that pair's looking — keyboard,
recorder, analysis and bar, end to end.

**Looking has one ordinary turn taken out of it.** The gap before a phase's first
turn holds the looking *and* the making of that turn, which takes as long as any
other. Left in, a cuber turning at an even ten per second with half-second looks
was shown 600ms of looking per phase and hands at thirteen turns a second — the
first version did exactly that, and an independent review caught it. The ordinary
turn is the median gap between turns inside phases, where nobody stops to look;
the tests pin that steady turning reads as its real speed.

**Every solve keeps its turns.** Practice solves used to store their phase totals
and throw the move stream away, so the most common kind of solve had no replay,
and its public page said it had been "entered by hand". History now keeps each
solve's stream as a compact string (about 350 bytes for 60 moves, roughly a fifth
of the same thing as JSON), and when storage runs short the oldest solves give up
their replay before any solve is lost. Sync sends the stream too.

**The server derives every stored breakdown.** Ranked, duels, challenges, rush
and sync all used to store the phase splits and last-layer cases the browser sent,
unexamined — beside a "verified" badge the server had only earned for the moves.
They are now worked out on the server from the stream it just replayed
(`src/lib/server/solveAnalysis.ts`), 3x3 only because CFOP is 3x3 only. For a
solve that arrives with a stream that holds up, a request that lies about its
breakdown, cases, move count or turn rate changes nothing that is stored. A stream
that does not hold up — unreadable, longer than the clock, faster than a human
turns, or past the request's replay budget — is dropped along with everything the
client derived from it. Only a solve with no stream at all (a stopwatch time, or
one recorded before streams were kept) keeps what it was sent, after validation,
because there is nothing else to know about it. `npm run integration:sync` and
`npm run integration` send each of those and assert what lands.

## Bringing a csTimer history across (`src/lib/cstimerImport.ts`)

csTimer is where nearly every cuber's history already lives, and that history is
the biggest reason not to try anything else: switching means starting from zero,
and every chart here starts out saying "not enough solves yet". `/progress` reads
the file csTimer's own **Export → Export to file** writes, in the browser — it is
never uploaded to be parsed — previews exactly which sessions are coming across and
which are not, and only then writes.

- **The format is csTimer's, read from its source** (`src/js/export.js`,
  `src/js/stats/stats.js`) and then checked against a file csTimer itself wrote:
  `e2e/fixtures/cstimer-export.txt` was produced on cstimer.net by pushing solves
  through its own timer signal and calling its own export routine. The unit tests
  parse that file, not just hand-built ones.
- **Imported solves are times, never ratings.** Stored as `manual`, like a stopwatch
  solve here: they count toward totals, bests, goals and trends, and cannot be split
  by phase or reach the ladder. The sign-up screen's projected rating is now drawn
  only from solves turned here, for the same reason — a year of real-cube times
  would otherwise set it on its own.
- **3x3 only, and the rest is named.** A 2x2 session is listed as left out, with
  its scramble type, rather than silently dropped or averaged in.
- **An import never costs a solve already here.** History keeps 2,000; imported
  solves fill the room that is left, newest first, and a re-import adds nothing
  twice. Merged history stays in time order, so a trend does not read last year's
  times as today's — and sync is rewound so the older solves still reach the server.

## Live races (`/race`, `src/lib/race.ts`)

Chess.com's core is two people playing at the same moment, and cubing had
nothing like it: the head-to-head challenges here are asynchronous on purpose,
because a live lobby needs two people online in the same second and a site
without players would leave everybody waiting for nobody. A race answers that
differently — it is made for two people who have already arranged it. One
creates it and sends the link; the other opens it and takes the seat; both press
ready; a countdown both screens place on the server's clock ends with the same
scramble appearing on both. It needs a friend, not a crowd, and every link is an
invitation.

- **The scramble exists before it is sent.** It is generated the moment both
  are ready and withheld through the countdown — to both players — because
  whoever read the network response first would otherwise get five seconds of
  study the other did not. The screen fires one poll at the start time, so it
  arrives within a round trip of zero.
- **Both pressing ready in the same instant starts it once.** The start is a
  write guarded on the lobby state it read, so the second of two simultaneous
  presses changes nothing: one scramble, one start time.
- **What you see of the other player is shown, never trusted.** How far through
  the solve they are — the stage (cross, each pair, OLL, solved) from
  `liveStage`, which can go down while an algorithm lifts a pair out, and their
  turn count — is bounded on the way in and decides nothing. The result is the
  server's verdict on both replayed solves.
- **The faster solve wins, not the first to finish.** Inspection is each
  player's, fifteen seconds of it, timed by the server from the start as in a
  ranked solve; the clock starts on the first turn. The browser suite first
  assumed the opposite — its guest started later, solved faster, and won — and
  the page now says so before anybody presses ready.
- **Walking away is a DNF**, ten minutes after the start, judged on read like
  every expiry here; it cannot deny the other player a result. Races do not move
  ratings — speed does not depend on being raced.

`e2e/race.py` runs two separate browsers through all of it on the keyboard,
including a rematch that lands both in the same new race.

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

**A challenge can be left open to anybody.** The two rules above assume you know
somebody's handle, and a live race assumes you have a friend to send a link to.
Neither is true for the person who arrives here knowing nobody — which, on a new
site, is everybody. So the opponent is optional: leave the offer on the board and
whoever turns up next takes it. Every rule above then applies unchanged, because
it is the same row with the second seat filled later — so accepting an offer six
hours after it was left confers nothing. Two people pressing "take it" in the same
instant is the ordinary case on a public board rather than the unlucky one, so the
seat is filled by a write guarded on the row it read; the second person is told
somebody got there first. One player may have three offers on the board at once:
ten would not be a busy player but a wall.

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

## Cleaning up (`src/lib/server/maintenance.ts`)

Five tables accumulate rows that stop being useful: expired sessions, spent
passkey challenges, redeemed email links, sign-in attempts outside every
rate-limit window, and events past a year. **None of them were ever cleaned in
production.** Three sweep functions had been written and were called only by
integration suites; `auth_attempts` had no sweep at all, and there was no cron.
Nothing was broken, which is precisely why it would have gone unnoticed.

`npm run sweep` does it, and a daily Vercel cron automates that. The ordering
matters: the last piece of scheduled work in this project was an
account-deletion webhook that was live, correct, tested, and refusing every
request because a secret was never set — and it was the only implementation of
the feature. Here the manual path works with no configuration at all, so the
secret being unset costs nothing.

Nothing here is load-bearing either way. Every rule these rows are subject to is
enforced on read as well: an expired session is refused because the timestamps
are checked, not because a sweep removed it. An unswept table is bigger, not
wrong.

## What is measured, and what is not (`src/lib/analytics.ts`)

Three questions decide whether this works, and until recently none of them
could be answered: does somebody who arrives actually solve a cube, do they come
back for a second session, and are they here tomorrow. `npm run retention`
prints them.

It is first-party and deliberately small. No third-party script is loaded, there
is no page-view counter, no session replay, and no way to ask a question that
was not decided in advance — the event names are a fixed list, and adding one is
a reviewed code change. That constraint is the point: an analytics tool that can
answer any question later is one that must collect everything now.

- The identifier is a random value in `localStorage`. Not a cookie, not a
  fingerprint, not derived from anything about the person. Clearing site data
  clears it and the next visit is a new visitor.
- **Do Not Track and Global Privacy Control are honoured.** A visitor who sets
  either is never given an identifier and never sends an event — nothing is
  sampled and nothing is anonymised, because nothing happens.
- No IP address is recorded. The `events` table has no column for one, which is
  a stronger guarantee than a policy.
- Deleting an account deletes its events, by cascade.

Two things this cost, both found by looking at the table rather than the code.
The route validated event names against a list imported from a `"use client"`
module, which arrives on the server as a client-reference proxy rather than an
array — so the allowlist threw on every request and **nothing was recorded at
all** while every screen dutifully reported events. And `join_view` landed twice
per visit, because React invokes effects twice in development; that would have
halved the measured conversion of the sign-up screen. Both are why the check is
"query the database", not "the request was sent".

⚠️ **Still owed before launch:** a `/privacy` page. Collecting a persistent
visitor identifier without a user-facing disclosure is not defensible, however
careful the implementation is, and the README is not where a visitor looks.

## Connecting a physical cube (`/cube`, `src/lib/cubeLink.ts`)

Turn the puzzle in your hands and the one on screen turns with it. Once it does,
the timer, the drills and every case take their moves from your cube rather than
the keyboard.

**The step almost everybody skips.** A Bluetooth cube reports *moves*, never
state. It says "R was turned"; it never says "here is the cube". So the app has
to assume where the cube started, and the assumption every implementation
reaches for is "solved" — which is wrong most of the time, because people pick up
the cube they were last using and it is scrambled.

Connect then, and every screen quietly lies. The virtual cube animates a puzzle
that is not the one in your hands, solve detection never fires because the
tracker thinks it is one move from home, and the case being drilled is not the
case in front of you. Nothing errors. It produces confident nonsense, which is
the worst failure this project can have.

So a link is not usable until it is **calibrated**: you solve your cube and say
so, once. Until then `isTrustworthy` is false and moves are dropped rather than
displayed. Asking the cube for its state instead only works on hardware that
offers it — cubing.js's shared interface does not — and shipping that would mean
the feature works on one brand and silently misleads on the rest.

**Tested without hardware, and honest about it.** Everything below the
`ConnectedPuzzle` interface is the same code whether moves arrive from a GAN over
Bluetooth or from `simulatedCube()`. That is what makes the flow testable at all,
since there is no smart cube in CI, and it is what "Show me how it works" runs on
so somebody can see the whole flow before buying one. It is not a substitute for
real hardware, and `/cube` says so on the page: no GAN, GoCube or GiiKER has ever
been held up to this.

**The check that matters looks at pixels.** `e2e/cubelink.py` screenshots the
cube and asserts it does not move before calibration. Reading the status line
instead would only ever test the state machine that writes it — and the symptom
that actually matters is visual. Verified by mutation: removing the gate leaves
the status text correct and turns the cube anyway, which the text check passes
and the pixel check fails.

## What search can see (`src/lib/sitemapRoutes.ts`)

Eighty-two pages existed that the sitemap had never heard of — `/solve`,
`/learn`, all 78 case pages, `/cube` and `/clubs`. Adding a route and adding a
sitemap entry were two separate acts connected by nothing, so the content was
built and then left invisible. Including the one page on this site written for
somebody who cannot solve a cube at all, which is the most searched thing in
this entire subject.

The list is now data, beside a reason for everything left out, and `npm run
audit` walks the app directory and refuses any page that is neither indexed nor
excused. A page can still be left out; it cannot be left out silently. It also
fails on a sitemap entry for a page that no longer exists, which would send
crawlers to a 404, and on an exclusion whose reason is blank — "not in the
sitemap" with no explanation is indistinguishable from "nobody remembered".

The 78 case pages are enumerated from the case library rather than typed out,
so they cannot drift from it. Nothing user-made is listed: profiles, solves,
clubs and challenge links are served when somebody shares them, not advertised.

## How to solve a cube at all (`/solve`, `src/lib/beginner.ts`)

`/learn` assumes you already reach the last layer. This assumes nothing: seven
steps, from a scrambled cube to a solved one, with every algorithm running on a
cube you can turn.

**The organising idea is the promise.** What defeats beginners is not forgetting
an algorithm — it is performing one and destroying the part they had already
finished, over and over, until they conclude they are not the sort of person who
can do this. So every step states what its algorithms leave alone, and every one
of those statements is *derived from the puzzle*: apply the algorithm to a solved
cube, compare orbit by orbit, and the slots that changed are the slots it
disturbs. A promise on the page that the algorithm beside it does not keep fails
the build.

"This will not wreck your first two layers" is the most load-bearing sentence in
any cube tutorial, and on most of them it is folklore. Here it is checked.

**The slot numbering is derived too.** A U turn moves corners 0–3 and edges 0–3
and nothing else — that is what makes those the last layer, and the rest follows.
Every promise is expressed in those indices, so a test pins them first.

**A step with no algorithm promises nothing.** The cross is done by eye, so the
page guarantees nothing there rather than guaranteeing something about moves
nobody specified.

**What the browser suite can and cannot check.** `e2e/howto.py` cannot check that
an algorithm is correct: the demo builds its starting position by running the
algorithm backwards, so performing it forwards returns to solved for *any*
sequence of moves — the same tautology the last-layer library fell into, and it
stayed green when the yellow-cross algorithm was mutated. What it does check is
that the demonstration demonstrates: no cube starts already solved, and stepping
through reaches the end.

## The keyboard layout is real (`e2e/keymap.py`)

`src/lib/keyMap.ts` is drawn on screen but decides nothing — cubing.js owns the
real bindings, and the app uses its copy only to highlight the key you pressed.
So the two can drift, and if they do the app teaches a beginner the wrong keys
with complete confidence.

The suite reads the cube's actual pattern before and after each key, then applies
every candidate move to the "before" state to see which reproduces the "after" —
so the move is identified by the puzzle, not by another table in this repository.
All 29 bindings are correct. Nothing had ever checked: the module's docblock
claimed a test like this existed, and none did.

## Learning the last layer (`/learn`, `src/lib/lastLayerCases.ts`)

All 57 OLL and 21 PLL cases, each with a cube you can turn.

**No algorithm here is trusted.** An algorithm in a cubing app is a claim, and a
wrong one costs somebody weeks — they drill it, it half-works, and they cannot
tell whether the algorithm or their own hands are at fault.

The obvious check is a trap, and this repository shipped it for one commit:
applying an algorithm's inverse to a solved cube produces a state, and applying
the algorithm to that state returns to solved — *always*, for any sequence of
moves whatsoever. It reads like verification and is arithmetic. Mutating a move
inside Sune left it passing.

What breaks the circle is a ground truth the algorithms had no hand in.
`lastLayer.test.ts` enumerates every reachable last-layer state from the puzzle's
own arithmetic — corner twists summing to zero mod 3, edge flips to zero mod 2 —
and finds exactly 58 orientation classes and 22 permutation classes. So the real
check is **coverage**: the 57 algorithms must produce exactly the 57 non-skip
classes, every one hit, none twice. A mistyped move lands on the wrong class and
leaves a real case with no algorithm. Add the property every last-layer algorithm
has by definition — it leaves the two layers below untouched — and a typo has
nowhere to hide. That check found a genuine bug on its first run: the PLL Ab
algorithm had its rotation the wrong way round and quietly moved an F2L pair.

**The numbering is pinned structurally.** A working algorithm filed under the
wrong number is the one error coverage cannot catch, so edge orientation — a
property of the case, not the label — is derived and checked: the seven cases
arriving with the cross made are exactly OLL 21–27, and the eight dots exactly
1–4 and 17–20.

**The shape groups are computed, not typed.** Cubers sort OLL by what the
oriented edges make — dot, L, line, cross — because that is what you see in the
half second before deciding. A grouping typed by hand drifts from the algorithms
beside it, and the first anybody knows is a learner drilling a case filed wrong.

**The camera is aimed at the subject.** cubing.js defaults to about 34 degrees,
right for checking a scramble where three faces matter equally. The last layer
lives entirely on top, and at 34 degrees the U face is a sliver. The studio looks
down at 62 — and the latitude *limit* has to move with it, or the request is
silently clamped and the view is identical to the default.

**Only what can be seen is built.** All 78 diagrams are drawn by the puzzle
engine and mounted as they scroll into view: 19 on arrival rather than 78 WebGL
contexts before anything appears. `e2e/learn.py` checks that lazy mounting still
draws something, because showing nothing is how that optimisation fails.

There is no "I got it" button. The case is built by running its algorithm
backwards from solved, so performing it correctly returns the whole cube to
solved — the cube answers, not the learner. A trainer that takes your word for it
is measuring your confidence.

## A solve you can send somebody (`/s/[id]`, `src/lib/replay.ts`)

Every timer on the internet can tell you that you took 14.2 seconds. This is the
page that shows you the 14.2 seconds: the move stream played back at the speed it
happened, with the phase that cost the time named against that cuber's own
average.

It is the most direct expression of the thing the whole project rests on. The
rating is the hook, the move stream is the moat — and a moat nobody can link to
is not doing any work.

**It is a recording, not an animation.** Every move is stored with the moment it
was made, so playback runs at the real tempo. That distinction is the entire
value: the pauses are the information. A replay at some invented constant speed
would show you the moves and hide the half second of nothing before an F2L pair,
which is where the time actually went.

**Par comes only from solves that existed when this one happened.** `reviewSolve`
compares a solve against what that cuber usually takes, and on the timer "usually"
means their history up to now — right for a verdict delivered once. A permalink is
read again later, by other people. Drawn from their whole history, a link shared
today saying *F2L cost you three seconds* becomes *F2L was fine* a fortnight later,
the number moving because the reader arrived late rather than because anything
about the solve changed. `npm run integration:solve` pins this: it adds eight much
faster solves *after* the one under review and asserts the verdict is identical to
the millisecond. Removing the filter moves it from 5.00s to 6.43s.

**Only competitive solves have a replay worth watching.** Practice is local-first
by design — it works offline and signed out — so a practice solve syncs as a time
with no move stream. The page says so plainly rather than showing an empty cube.

Both ends of the playhead have been wrong, and both are pinned in
`src/lib/replay.test.ts`, because an off-by-one in a replay is invisible in a
screenshot — it looks like a cube. At `0.00` nothing may be turned: the first
move is stamped at 0, so an inclusive comparison silently skipped the scrambled
state, the one thing you want to study before pressing play. And the clock runs a
millisecond past the final move, so a solve whose last turn lands on the buzzer
can actually complete.

## Clubs and the WCA (`src/lib/club.ts`, `src/lib/wca.ts`)

Two features that exist because cubing is a solo sport. You solve alone against
a clock, which is why a free solo timer still dominates and why the network
effect that makes chess.com unassailable does not exist here.

**A club** is the closest thing to a reason two people both turn up. School and
university cubing clubs already meet and already compare times; this gives that
somewhere to live. The board reads the **same verified ratings** as the global
one — no club-local scoring, no separate ladder. A private board with friendlier
numbers is more flattering and completely worthless, because the whole claim
here is that a rating means something.

Unrated members are listed, without a number and without a position, sorted by
how close they are to being rated. A board showing only the rated would greet a
beginner on the day they join with a list they are not on.

**The WCA link** answers the question only a site with a real rating can ask:
how does what you do here compare to what you did at a competition? Two rules
make it honest.

*A link is proved, never claimed.* There is no way to type a WCA id in. Every
WCA id is public, so a text field would let anybody attach a world-class average
to their profile. The only route is the WCA's own OAuth, and with no credentials
configured the feature is simply not offered.

*The two numbers are never subtracted.* A WCA average is five solves on a real
cube, in a hall, judged. A keyboard rating is five solves typed. Showing a delta
between them would invite reading a difference in input device as a difference
in the cuber — so both are shown, each labelled with what it measured, and the
official average is also converted to this scale so the two are commensurable
without pretending they are the same. Nothing read from the WCA ever writes to
`ratings` or reaches a leaderboard.

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
