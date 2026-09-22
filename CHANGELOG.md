# Changelog

Notable changes, newest first. Bug fixes are listed when the bug is worth
knowing about — several here are more interesting than the features.

## 1.3.0 — 2026-09-22

The release where the solver stopped guessing how far phase one was from its
goal and started knowing.

### A solver that knows the distance

- **An exact phase-one table.** All three phase-one coordinates at once are 2.2
  billion positions; the sixteen symmetries that leave the up-down axis alone
  fold them into **141 million**, which fits in 67MB at four bits each and builds
  in eleven seconds. Where the old pair tables gave a lower bound that sagged
  with depth, this gives the answer: exactly how many moves the position needs.
  Phase one went from 773 million search nodes across sixty cubes to 118 million.
- **Shorter routes, sooner.** At the server's settings the mean fell from 19.15
  to **18.93 moves** and the median from 147ms to **27ms**, with nothing over
  451ms. The quicker default now takes 20 moves rather than 21 — a whole move
  shorter — and is no slower than the old default was.
- **The symmetries are derived from the cube's shape**, not transcribed: the same
  code, asked for the six face turns, reproduces the move tables the engine has
  always used, and asked for the rotation about the corner diagonal reproduces
  the one the six-sided search uses. That is what makes the other sixteen — which
  cannot be compared against anything — trustworthy.
- **The daily scrambles' routes were recomputed**: mean 18.73 moves before, 18.32
  now.
- **`npm run verify:tables`** checks the generated table against the same question
  asked the slow way, and against itself under every symmetry. Two ways of
  building it wrong were tried on purpose to confirm it goes red — including the
  subtle one, which produces distances that are too high, and so loses shortest
  solutions without ever looking broken.

### Fixed

- **Deploys were uploading eleven files git has never tracked**, among them a
  backup of old database keys and the private key of the local test certificate,
  into the deployment's source. Nothing was served — the files 404 and the source
  view needs the owner's login — but Vercel does not read `.gitignore`, so
  `.vercelignore` now ignores everything and lets back in only what git tracks.
  The audit fails if either half drifts.
- **The tables are carried only into the two routes that solve**, rather than
  into every API route. The audit works out which routes reach the solver and
  fails if that list and the configuration disagree — a route without the tables
  solves several times slower and says nothing.

## 1.2.0 — 2026-09-22

The release where two people can race the same scramble at the same moment, and
the solver started looking at every cube from six sides.

### Live races

- **`/race` — race a friend, live.** Create a race, send the link, both press
  ready, and after a five-second countdown on the server's clock the same
  scramble appears on both screens. Each sees the other's progress as it happens
  — cross, each pair, OLL, solved — and the server names the winner from both
  replayed solves. A rematch puts both players in one new race.
- **The scramble is withheld from both players until the start.** It is created
  when both are ready and sent to nobody during the countdown, so whoever reads
  the network first gains nothing.
- **Both pressing ready at once starts the race once** — one scramble, one start
  time — and the second seat can never be taken by a third person.
- **Signing in from a race link brings you back to the race.** Sign-in and
  claiming an account now follow a checked `?next=` path instead of always
  landing on the home page.

### A shorter solver

- **Six views of every cube.** The solver searches the cube, its two rotations
  about the corner diagonal and the inverses of all three, sharing one best
  answer and one clock. The server's mean solution fell from 19.74 moves — with
  one solve in five running into its time limit — to **19.02**, median 91 ms,
  every one verified.
- **A redundant finish is skipped.** A phase-one path that reaches the subgroup
  on a move phase two could have made is a duplicate, and is no longer finished.

### Fixed

- **A race was won by whoever finished first on screen.** The browser suite
  assumed it: its guest started later, solved faster and won. A race is decided
  by solve time — inspection is each player's own — and the page now says so
  before anybody presses ready.
- **The race pages showed nothing to a brand-new account**, because they read the
  profile instead of creating it on the first visit like every other page.

## 1.1.0 — 2026-09-21

The release where the analysis stopped inferring and started measuring, identity
stopped being rented, and the site learned to teach as well as to rank.

### Why you are slow, measured

- **Looking and turning.** Every phase after the cross is split into the time
  before its first turn — between F2L pairs, recognising the OLL and PLL case —
  and the time spent turning. `/progress` no longer guesses whether a slow phase
  is recognition or execution from how much it varies: it compares your slower
  solves with your faster ones and says which part the extra seconds went to.
  The replay draws the looking on its timeline and jumps to your longest pause.
- **Every solve keeps its turns.** Practice solves used to keep their phase
  totals and throw the move stream away, so most solves had no replay. History
  now stores the stream compactly, and when storage runs short the oldest solves
  give up their replay before any solve is lost.
- **The server works out every stored breakdown.** Ranked, duels, challenges,
  rush and sync all stored the phase splits the browser sent, beside a "verified"
  badge earned only by the moves. They are now derived on the server from the
  stream it just replayed; a request that lies about them changes nothing.

### Bring your csTimer history

- **Import a csTimer export on `/progress`**, read in the browser and previewed
  before anything is written. 3x3 sessions come across as times; other events are
  named and left out; nothing already here is ever pushed out to make room. Checked
  against a file csTimer itself wrote, not only against a reading of its source.

### Your own account

- **Passkeys first, passwords as a fallback, recovery by email link** — written
  here rather than rented. WebAuthn from scratch, including a CBOR decoder tested
  against RFC 8949's own vectors; scrypt at OWASP's memory-constrained parameters;
  sessions as rows, so signing out everywhere actually does.
- **The claim.** Signing up leads with the solves you already did, which is what
  the account is for.

### More to play, more to learn

- **2x2, 4x4 and 5x5**, ranked on their own scales — 25 seconds is world class on
  4x4 and nowhere near it on 3x3.
- **Rush:** a target built from your own pace that tightens until you miss three.
- **Clubs**, a board for the people you actually cube with, reading the same
  verified ratings as the global one.
- **WCA link**, proved through the WCA's own sign-in and never typed, so nobody
  can attach a world-class average to their name.
- **A solve you can send somebody:** `/s/<id>` plays it back at the speed it
  happened.
- **All 57 OLL and 21 PLL cases** on a cube you can turn, checked by coverage
  against every last-layer state the puzzle can reach — which found a PLL
  algorithm that quietly broke an F2L pair.
- **How to solve a cube at all** (`/solve`), for the most-searched question in
  the sport.
- **Your cube:** a smart cube linked and calibrated before any move is trusted.
  Not yet run against real hardware, and the page says so.
- **Cube appearances**, including a high-contrast scheme found by simulating
  colour blindness — the one chosen by eye was worse than the default.

### How it is built and checked

- Solver tables precomputed at build: the cold start went from ~2s to 30ms of
  table loading.
- `npm run audit` checks the repository's claims about itself — links, routes,
  docs, counts, the sitemap, and that every commit credits its owner alone.
- The database suites run against a throwaway local Postgres with Supabase's own
  roles and grants — in CI on every pull request, for the first time — and
  `npm run e2e:local` runs every browser suite against it with no credentials.
- First-party analytics that honour Do Not Track and Global Privacy Control
  before an identifier exists, and a privacy page that says so.

### Fixed along the way

- **Challenge solves were never stored.** A check constraint predated the mode,
  the insert failed, and the error was discarded.
- **A momentary read failure could overwrite an established rating** with a new
  player's.
- **The analytics layer recorded nothing** — a server route imported a list from
  a client module and got a proxy that threw on every request.
- **The cross-efficiency line had never been shown to anybody.** The page looked
  for a phase named "cross"; the analysis writes "Cross".
- **The sign-up screen projected a ladder rating from stopwatch times** — a real
  cube timed by hand, which is a different sport from the keyboard ladder. It is
  drawn only from solves turned here now.
- **The engine's route was called "the shortest possible".** It is short, not
  proven shortest — a random cube's true minimum is 17 or 18 moves about 95% of
  the time, and the engine runs a couple longer. The copy, the README and the
  docs now say so, and both comparisons count moves in one unit.

## 1.0.0 — 2026-08-18

Everything a 3x3 platform needs, and nothing claimed that the code cannot
support. Live at [cubeduel.vercel.app](https://cubeduel.vercel.app).

### The ladder

- **A rating in log time**, anchored at 5s = 3000 and 15s = 2000, so every rating
  converts exactly back to the average that earned it. Not Elo — Elo exists
  because chess has no absolute scale, and cubing has seconds.
- **Server-issued scrambles, server-replayed solves.** The scramble is generated
  when you ask for it, and your move stream is replayed against that exact
  scramble. If the cube does not end solved, the result does not exist.
- **DNFs cost certainty, not points.** A failed average widens your margin of
  error and leaves the rating untouched, so abandoning a bad solve can never gain
  you anything and no fabricated time is ever recorded.
- **WCA inspection**, timed by the server from when it issued the scramble:
  fifteen seconds, +2 (A4b1), DNF past seventeen (A4b2), with the 8 and 12 second
  warnings.

### Playing other people

- **Head-to-head challenges.** Pick somebody and you both solve the same
  scramble, whenever suits you. Neither of you sees it until you open your own
  attempt, and neither time is shown until you have both finished.
- **Bot duels** where the opponent's entire trajectory is committed to the
  database before you turn a face, so it provably cannot speed up when it is
  losing. Its solution is real and passes the same verifier a human's does.

### Practice

- **A from-scratch Kociemba two-phase solver** in TypeScript. Over 100
  random-state scrambles: every cube solved, mean 20.65 moves, median 69ms, all
  under a second.
- **CFOP splits** on every solve, and the move count your scramble actually
  needed — a timer can tell you how long you took, only a solver can tell you
  whether the cube was hard or you went the long way round.
- **A trainer that schedules on measured time**, from cases your own solves
  produced rather than a hand-typed table of 57 algorithms.
- **Goals that refuse to predict** unless the improvement clears twice the
  standard error between halves of your history.
- **A daily scramble** with a shareable breakdown of solve *shape* rather than
  speed.

### Everywhere

- Works on a phone: every mode is solvable by tapping, with no keyboard.
- Works signed out and offline for practice, the daily, progress and the trainer.
- Every page has one `h1`, every control has an accessible name, and an
  accessibility suite runs over all of them.

### Fixed along the way

The ones worth knowing about:

- **Ranked was completely dead in production** for two unrelated reasons at once:
  `randomScrambleForEvent` hung forever because bundling broke its worker and
  WASM resolution (fixed with `serverExternalPackages`), and fractional
  `performance.now()` durations were rejected by an integer column.
- **`REVOKE EXECUTE ... FROM public` protected nothing.** Supabase's default
  privileges grant `anon` and `authenticated` their own EXECUTE at creation. A
  request carrying only the publishable key reached the rating function's body.
- **A failed first rating window stored a rating of `0`** — below the scale's
  floor of 100 — because the column was `NOT NULL` and there was no rating to
  store.
- **A new account's first page load could render "Something broke."** Concurrent
  first visits raced to create the profile and the fallback path threw straight
  through the conflict.
- **Boards rendered "Nobody is ranked yet" during an outage**, which is
  indistinguishable from the truth and so gets investigated by nobody.

[1.3.0]: https://github.com/arhancanli/cubeduel/releases/tag/v1.3.0
[1.2.0]: https://github.com/arhancanli/cubeduel/releases/tag/v1.2.0
[1.1.0]: https://github.com/arhancanli/cubeduel/releases/tag/v1.1.0
[1.0.0]: https://github.com/arhancanli/cubeduel/releases/tag/v1.0.0
