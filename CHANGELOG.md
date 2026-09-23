# Changelog

Notable changes, newest first. Bug fixes are listed when the bug is worth
knowing about — several here are more interesting than the features.

## 1.7.0 — 2026-09-23

Solve review: every solve read back one turn at a time.

### What it finds

Chess has game review. Cubing never had the equivalent, because nothing else
keeps the turns. This does, so after a keyboard or smart-cube solve the first
button is now **Review this solve**, and it stops the tape at:

- **The cross route** — your cross against the shortest one on the same face,
  from the same scramble, with that route written out. The one judgement here
  made against something other than you, and it is made against a proven
  optimum: the route is walked down the exact distance table, so it is never
  longer than the shortest possible.
- **Pauses** — a gap at least four times your ordinary one and at least 0.8s.
  Before a phase's first turn it is named as looking for the next thing; inside
  a phase, as the hands stopping. The three costliest are kept.
- **Turns undone** — R then R'. Across a phase boundary this is named as two
  algorithms cancelling, with the technique that removes both, rather than as a
  misread piece.
- **The long way round** — R R R where R' would do. R R is left alone: it is how
  a keyboard makes R2.
- **Rotations during F2L**, counted once rather than listed one by one.
- **A two-look last layer** — an OLL or PLL that took far more turns than the one
  algorithm for that case — with a link to learn the case.
- **Skips**, credited as the luck they are.

Choosing a moment plays the replay from just before it. Every cost is priced
at your own pace in that part of the solve; the total is called *recoverable*,
never *wasted*, and the page says it is a ceiling rather than a promise.

### Where it is

- **`/review`** lists every solve on this device that kept its turns, signed in
  or not. Everything is worked out in the browser — the cross table is 190,080
  bytes built in milliseconds — so it needs no account and works offline.
- **Shared solve pages** (`/s/…`) now carry the full review beside the replay.
- **Review** joins the Practice half of the nav.

### Fixed

- **Phase splits credited a pair mid-insertion.** A pair counted as in whenever
  its two pieces sat in their slot — including the instant in U' L' U L when the
  L' has lifted a cross edge and the slot happens to look solved. The pair's
  boundary landed two turns early and every later phase slid by one: the front
  page's own demo solve was read with a two-turn F2L 2 and a twelve-turn OLL. A
  pair now counts only with the cross intact beside it. Found because the
  review's browser suite planted a pause before the third pair and was told it
  came before the fourth.

## 1.6.0 — 2026-09-23

The release where it stops looking like a document and starts looking like a
place to play.

### Six modes, six faces

- **Every competitive mode owns one sticker colour**, and the assignment is the
  standard Western colour scheme laid out as a cube net: Daily on top in white,
  Race on the left in orange, Solve in front in green, Ranked on the right in red,
  Duel at the back in blue, Rush underneath in yellow. The home page draws that
  net, and each mode keeps its colour everywhere else — the sidebar, its tile, its
  own page — so a colour always means a place.
- **The icons are 3×3 sticker pictograms** in the mode's colour. Daily is a whole
  solved face; Rush is a shape that narrows.

### A real shell

- **A sidebar on wide screens**, with the same Compete and Practice groups as
  before, a green "Solve now" button at the top and your account at the bottom.
- **On a phone, a tab bar and a drawer.** The old header scrolled sideways and a
  phone showed five of fourteen destinations, so Timer, Learn, Train and Progress
  could not be reached from the nav at all. The drawer is the same `<nav>` as the
  sidebar, so a screen reader hears the same structure at any width.
- **Everything still disappears while you solve**: sidebar, tab bar and all.

### Type, colour and controls

- **Archivo for headings, buttons and the clock** — a wide, heavy scoreboard
  face — with Figtree for reading and Geist Mono kept for notation.
- **A deep blue-black ground** in place of neutral grey, so the sticker colours
  read as colours.
- **Buttons that feel like keys**: the primary action is green with a darker
  bottom edge that the press removes. There is one of them per screen.

### Pages

- **The front page** leads with the claim and the cube net, then what is live
  today: the daily's number and time left, how many open challenges are waiting
  (the board's own count, signed out), and the way into a race. Somebody who has
  solved here before sees their solve count, best single and last ao5 instead of
  the pitch.
- **Signing in to a mode is a door, not a dead end.** Ranked, Rush, Duel and
  challenges used to show one grey sentence on an empty page. They now show the
  mode, what it is, a button that signs you in and brings you back, and the
  account-free alternative beside it.
- **Leaderboard, Race, Clubs and the Daily** open with a proper title.
- **Share cards, emails and the tab icon** use the new colours and mark.

The design system — tokens, type ramp, buttons, mode faces and the home screens —
is in Figma alongside the code.

## 1.5.0 — 2026-09-22

The release where you no longer need to know somebody to play somebody.

### A challenge anybody can take

- **Leave a challenge open on the board.** A named challenge needs a handle you
  already know; a live race needs a friend to send a link to. Neither works for
  somebody who arrives here knowing nobody, which on a new site is everybody. An
  open challenge sits on the duel page and whoever turns up next takes it.
- **It is the same row with the second seat filled later**, so every rule that
  made a challenge fair holds unchanged: the scramble is generated at creation
  and shown to neither side until their own attempt opens, and neither time is
  shown until both have solved. Accepting an offer six hours later gains nothing.
- **Two people taking it at once**: exactly one gets the seat — the write is
  guarded on the row it read — and the other is told somebody got there first,
  which on a public board is an ordinary event rather than an error.
- **Three offers per player at a time.** Ten would not be a busy player but a
  wall, and the board is a page everybody sees.
- **The board excludes your own offers**, because the one thing you cannot do
  with your own challenge is take it, and a board where half the rows refuse you
  is a worse board. Yours appear in your own list, marked as waiting.
- **Challenge links now draw a share card** — the last shareable link without
  one. An open challenge says so and invites whoever reads it; a challenge sent
  to a named player names only who sent it, since anybody with the link can fetch
  the card.

### Fixed

- **An offer you left appeared under "Your turn" with an empty name** where an
  opponent's handle should be. There is no opponent yet — that was the point —
  so it has its own section, and you can still open your own half whenever.

## 1.4.0 — 2026-09-22

The release where a link to this site stops being a bare URL.

### Every link carries its own picture

- **A race link is an invitation, and now looks like one.** Paste it into a chat
  and the preview says who is asking, on which event, and the rule people get
  wrong before they press ready — the faster solve wins, not the first to
  finish. Once both players are in, it names them; once it is over, it says who
  won and by how much.
- **Solve permalinks** show the time, the moves, the turns per second, and
  whether the solve was replayed and verified — which is the claim this site
  exists to make, so its absence is written out rather than left off.
- **Player pages** show the rating with its ±, or the word "unrated" where it
  has not settled. A card is the most screenshotted surface here and the least
  likely to carry its context, so it follows the same rule as everywhere else.
- **No card ever mentions the scramble.** A race and a challenge are one cube
  shared between two people, and a preview showing it would let whoever opened
  the link study the solve in the group chat. There is a test for it.
- **Fetching a card cannot change anything.** The race preview reads without
  settling the race: a link preview is a robot looking at a message, and a robot
  should not be able to declare somebody's race abandoned by looking at it.
- **`e2e/cards.py`** fetches every card the way a chat app does, against real
  rows, and checks each is a real PNG of the right size and not the picture the
  site draws when the thing does not exist.

### Fixed

- **A long name pushed a card off its own edges**, and a display name that was
  just the handle printed twice: "arhan (@arhan)". Both found by looking at the
  rendered image rather than the code.
- **The audit could not see a browser suite whose name had an underscore.** It
  failed, which was the safe direction, but for a reason the message did not
  explain.

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

[1.5.0]: https://github.com/arhancanli/cubeduel/releases/tag/v1.5.0
[1.4.0]: https://github.com/arhancanli/cubeduel/releases/tag/v1.4.0
[1.3.0]: https://github.com/arhancanli/cubeduel/releases/tag/v1.3.0
[1.2.0]: https://github.com/arhancanli/cubeduel/releases/tag/v1.2.0
[1.1.0]: https://github.com/arhancanli/cubeduel/releases/tag/v1.1.0
[1.0.0]: https://github.com/arhancanli/cubeduel/releases/tag/v1.0.0
