# Changelog

Notable changes, newest first. Bug fixes are listed when the bug is worth
knowing about — several here are more interesting than the features.

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

[1.0.0]: https://github.com/arhancanli/cubeduel/releases/tag/v1.0.0
