# The solving engine

A from-scratch implementation of Kociemba's two-phase algorithm, in TypeScript,
in `src/lib/solver/`. This document is the reasoning: what the algorithm is, why
each piece is shaped the way it is, what was measured, and which of my first
attempts were wrong.

**Result.** Over 200 uniformly random states, searching from six sides at the
settings the server uses: every cube solved, mean **18.93 moves** (half-turn
metric), median **27ms**, nothing over 451ms. At the quicker default, mean 19.70
with a median of **8ms**. Tables load in about 170ms from the precomputed files,
the larger of which is 141 million exact distances (§8). That is short, not
shortest: the average true minimum for a random cube is about 17.7 moves, so
these routes run a little over one move long. See
[What this is not](#11-what-this-is-not).

---

## 1. The problem

A 3x3 cube has

    8! × 3⁷ × 12! × 2¹¹ / 2  ≈  4.325 × 10¹⁹

reachable states. The divisions matter and are the same three constraints the
code validates: corner orientations sum to 0 mod 3, edge orientations to 0 mod 2,
and the corner and edge permutations always share parity. A state violating any
of them is a cube that was taken apart and rebuilt wrong — no sequence of turns
reaches it, and a solver handed one will search forever rather than report a
problem. `validate()` refuses it at the door and names which law it breaks.

In 2010 the diameter of this group was proven to be **20** in the half-turn
metric: every cube is at most 20 moves from solved. Finding a PROVABLY shortest
solution is expensive — optimal solvers can take minutes per cube. Almost nobody
needs optimal. They need short, now.

## 2. Two phases

Kociemba's insight is to solve an easier problem twice, using the subgroup

    G1 = ⟨U, D, R2, L2, F2, B2⟩

**Phase one** ignores nearly everything and only drives the cube *into* G1: every
corner untwisted, every edge unflipped, the four middle-slice edges somewhere in
the middle slice. **Phase two** finishes using only G1 moves, which by
construction cannot undo what phase one achieved.

Each half is small enough to search exhaustively with a decent heuristic. Phase
one takes at most 12 moves, phase two at most 18.

The choice of G1 is not arbitrary. It is exactly the set of moves that preserve
both orientation coordinates, which is why the edge-orientation convention is
defined against the F/B faces: with that definition, `U D R L` and every double
turn leave edge orientation untouched and only quarter turns of F and B flip
anything. `cube.test.ts` asserts this directly — F and B each flip exactly four
edges, the other four faces flip none — because if the convention were wrong the
search would be exploring the wrong subgroup and would never terminate correctly.

## 3. Coordinates

Search cannot work on a cube; it works on small integers that a move transforms
by table lookup.

| Phase | Coordinate | Size |
|---|---|---|
| 1 | corner orientation | 3⁷ = 2,187 |
| 1 | edge orientation | 2¹¹ = 2,048 |
| 1 | middle-slice edge positions (unordered) | C(12,4) = 495 |
| 2 | corner permutation | 8! = 40,320 |
| 2 | U/D edge permutation | 8! = 40,320 |
| 2 | slice permutation | 4! = 24 |

Only seven corner orientations are stored because the eighth is forced by the
invariant; likewise eleven of twelve edges. The slice coordinate deliberately
discards *order* — phase one only cares that those edges are in the slice, and
tracking their arrangement would multiply the table by 24 for information phase
one never reads.

The property everything rests on is that a move's effect on a coordinate depends
**only on that coordinate**, never on the information thrown away. That is what
makes a move an array read. It is also easy to assume and expensive to get wrong,
so `coords.test.ts` checks it directly: take a real scrambled cube and a
synthetic cube built from nothing but its coordinate — two cubes that agree on
almost nothing — apply any move to both, and confirm they still agree.

## 4. Pruning, and the mistake that cost the most

IDA* needs an admissible heuristic: a lower bound on moves remaining that never
overestimates. Each pruning table stores the exact distance to the goal for a
*pair* of coordinates, computed by breadth-first search backwards from the goal.

Pairs rather than the full triple purely for memory — all three phase-one
coordinates at once would be 2,187 × 2,048 × 495 ≈ 2.2 billion entries. That is
how the engine worked for its whole first life, and §8 is how the full table was
had anyway: the cube's own symmetry folds those 2.2 billion into 141 million.
The pair tables below are still built, and still used wherever the bigger one has
not been generated.

My first version used the two obvious pairs, (twist, slice) and (flip, slice).
Both max out at **9**. A phase-one solution runs to 12, so near the root the
bound never exceeded the remaining depth and never fired — the search was
effectively brute force with a 15-way branching factor. Solving 25 scrambles did
not finish in ten minutes.

Adding a **(twist, flip)** table fixed it. Orientation is the harder half of
phase one, and pairing the two orientation coordinates captures the interaction
the slice-paired tables miss. It costs 2,187 × 2,048 = 4.5MB, which is nothing
against the difference between milliseconds and never.

| Table | Entries | Max depth |
|---|---|---|
| twist × slice | 1,082,565 | 9 |
| flip × slice | 1,013,760 | 9 |
| twist × flip | 4,478,976 | 9 |
| cornerPerm × slicePerm | 967,680 | 14 |
| edge8Perm × slicePerm | 967,680 | 12 |

Every one of these has **zero unreachable entries** after BFS, which is a strong
correctness signal in itself: if a move table were wrong, the search from the
goal could not reach every coordinate pair that exists. `search.test.ts` asserts
it.

## 5. Move ordering

Two filters cut the branching factor from 18 to about 13 without losing any
reachable state:

- Two turns of the same face in a row are one turn in disguise.
- Opposite faces commute, so `U D` and `D U` reach the same state. Fixing an
  order between them — lower face index first — discards exactly one of each pair.

**The seam was unchecked.** Both filters ran within each phase, and not across
the boundary between them. Solving a cube scrambled by a single `R` returned
`R R2` — two moves that are one move, `R'`, and a pair neither phase would have
allowed had it seen them together. Phase two now receives the face phase one
ended on. Nothing is lost by forbidding it: any combination reachable by ending
phase one on a face and immediately reusing it is also reachable by phase one
ending on the merged turn, which phase one already explores.

## 6. Knowing when to stop

The first solution found is usually not the best. A slightly longer phase one
often opens a much shorter phase two, so the search keeps going: deeper phase
ones, re-solving phase two, keeping the best total.

Two stopping rules end it, and one early version of a third was a bug.

- **`length ≤ depth`.** A phase-one solution of length `depth` already costs
  `depth`, so if the best total is no longer than that, nothing deeper can beat
  it. This is the rule that makes termination cheap.
- **Target reached.** Checked *between* depths, not inside one.
- ~~Stop the moment any solution clears the target.~~ This was wrong. Phase-one
  solutions are enumerated in move order, not in order of how good the total will
  be. `R` comes before `R'` in the move list, so a cube one move from solved was
  being "solved" in eight moves — the first total to clear a generous target of
  21. Finishing the current depth costs almost nothing shallow and is bounded by
  the budget deep.

The time budget governs **improvement**, not the first answer. Returning nothing
is useless to a caller, and at tight budgets that is exactly what happened for
roughly one state in eight. The first solution is always found; the budget
decides how hard the solver then tries to beat it.

## 7. Looking from six sides

Profiling the search at a target of 19 put **85% of the time inside phase one**.
Phase two, the part that looks expensive on paper, was under 5%. So the question
was not how to finish faster but how to reach a good phase one sooner — and two
changes did most of it.

**Stop re-solving the same phase two.** A phase one that ends on a move phase two
could have made — U, D, or a half turn — reaches G1 from a state that was already
in G1, because G1 is closed under its own moves. That state was handed to phase
two one depth earlier, with the move as phase two's first. The search was
re-solving it for every such ending. Skipping them is exact, not a heuristic.

**Search the cube from six directions at once.** Phase one's goal, G1, is defined
by one axis. A cube can be awkward from U-D and easy from R-L, and a search that
only ever looks one way cannot tell. So the cube is also searched turned a third
and two thirds of the way round its URF-DBL diagonal (U→R→F), and all three of
those inverted. A solution to any of the six converts back: rotate each move back,
and for an inverse, reverse and invert the sequence. The six share one
best-so-far and one clock and take turns depth by depth, so every depth is tried
from every side before any side goes deeper — and six views cost no more time than
one, because the time goes where the cube is easiest.

The rotation is written out once, in `symmetry.ts`. Which face becomes which is
*derived* by conjugating the six face turns and matching the result, not typed.
The tests check that three rotations are no rotation, that each derived map is a
permutation of the faces, and that a solution found from every one of the six
views, translated back, solves the original — and two mutations (translating an
inverse without reversing it, and using the wrong rotation's map) each fail them.

## 8. The exact phase-one table

The pair tables above are projections, and a projection underestimates. Near the
goal they are nearly right; deep in the search, where it matters, they are not,
and the measurements said so plainly: at the server's settings **86% of the time
went to phase one** — 773 million nodes across sixty cubes against 38 million in
phase two. The bound was the bottleneck.

All three phase-one coordinates at once would be exact, and there are
2,187 × 2,048 × 495 ≈ 2.2 billion of them, which is why this document used to
stop here. But the cube does not care which way up it is. Sixteen symmetries
leave the U-D axis alone — four turns about it, each with and without a half
turn about F-B, each with and without a mirror — and phase one's goal is stated
entirely in terms of that axis, so positions related by one of them are the same
distance from G1. Storing one position per class turns 1,013,760 (flip, slice)
pairs into **64,430**, and the table into 64,430 × 2,187 ≈ 141 million entries:
**67MB at four bits each**, built in eleven seconds.

Its number is not a bound. It is how many moves the position needs.

### Where the symmetries come from

`cube.ts` describes states as permutations of pieces, which cannot answer "what
does this look like mirrored?". `geometry.ts` puts the cube back in space —
where each face points, which stickers each slot holds, in order — and derives
the symmetries from the shape. Derived, not transcribed, and that is checkable:
the same code, asked for the six face turns, produces `BASE_MOVES` exactly, and
asked for the rotation about the URF-DBL diagonal produces the `URF3` of
`symmetry.ts`. Two of its outputs can be compared against tables that were
checked against cubing.js; the other sixteen cannot be compared against
anything, and come off the same machinery.

A mirror is not a turn — no sequence of moves mirrors a cube — so a mirrored
state is a description rather than a position, and it exists only inside a
conjugation `S⁻¹ X S`, where the two reflections cancel. While it exists, a
corner's stickers run the other way round; Kociemba's convention, followed here,
extends corner orientation to 0-5, and `multiplyFull` is ordinary composition
everywhere else. The search never sees a value above 2.

### Filling it

Breadth-first from solved, scanned rather than queued: a queue of 141 million
indices would cost more than the table it fills. Each pass walks the whole table,
expanding forwards while the frontier is the smaller side and turning around when
most of the table is known — at depth 10, asking each unknown position whether a
neighbour is one move nearer is far less work than expanding 76 million known
ones.

One subtlety decides whether the result is right. A class representative fixed by
some symmetry is the same position under more than one corner twist, and a fill
that sets only the entry it arrived at leaves the others looking further away
than they are. Distances that are too high are exactly the failure that cannot be
seen: the search cuts the branch holding the shortest solution and returns a
longer one, with nothing reporting a problem. Deleting that rule and rebuilding
is one of the mutations `scripts/verify-solver-tables.mts` is checked against —
it reports positions whose mirror image is a different distance from G1.

### What it bought

Phase one went from 773 million nodes to 118 million for the same sixty cubes,
and then to fewer still once the cube handed to phase two stopped being rebuilt
from scratch two million times a solve — a depth-first search changes only the
tail of its path, so only the tail needs redoing. At the server's settings the
mean fell from 19.15 moves to 18.93 and the median from 147ms to 27ms; the table
of §9 has the rest.

It is generated, never committed — a stale table of exact distances is worse than
no table — and the loader refuses any file whose version or declared lengths do
not match this build, falling back to the pair bounds. That fallback is a real
path, not a theoretical one: it runs wherever the file has not been generated, so
`search.test.ts` exercises both on purpose rather than whichever the file system
happens to offer.

## 9. Measurements

200 uniformly random legal states, laptop, tables loaded. "Pair bounds" is the
same search with the exact phase-one table withheld (`exactTable: false`), which
is what a caller that has not generated it gets.

| Options | Bound | Mean length | Median | p95 | Mean time |
|---|---|---|---|---|---|
| `21`, `250ms` | pair | 20.55 | 7ms | 30ms | 10ms |
| `21`, `250ms` | exact | 20.55 | 6ms | 27ms | 8ms |
| **default** (`20`, `150ms`) | pair | 19.81 | 15ms | 150ms | 33ms |
| **default** (`20`, `150ms`) | exact | **19.70** | **8ms** | **39ms** | 13ms |
| **server** (`19`, `450ms`) | pair | 19.15 | 147ms | 451ms | 211ms |
| **server** (`19`, `450ms`) | exact | **18.93** | **27ms** | 451ms | 105ms |
| `18`, `450ms` | exact | 18.66 | 451ms | 451ms | 311ms |

Two things to read out of it. The default now takes 20 rather than 21 and is no
slower than the old default was, which is the exact table paying for itself; and
each move nearer the true minimum still costs several times the last, because
what is expensive is no longer the bound but the number of phase ones that have
to be tried before one of them has a short phase two. That is why the server
takes 19 at 450ms rather than 18: 18 is only 0.27 of a move better and spends
the whole budget on nearly every scramble instead of 27ms.

The historical figures, before any of this, were a mean of 20.50 at the old
default and 19.74 at target 20 with a 1.5 second budget, with one solve in five
running out the clock. The six-sided search (§7) took that to 19.64, and the
exact table took target 19 from 19.02 to 18.93 while cutting its median from
91ms to 27ms.

Every solution in every run was verified by applying it and checking the cube
ended solved. A solver that returns plausible-looking moves which do not solve is
worse than one that returns nothing.

## 10. Testing

The move tables are transcribed by hand from Kociemba's definitions, which is
exactly the kind of thing that is silently wrong: one swapped index produces a
solver that runs forever on some states and returns wrong solutions on others,
with no error anywhere.

They are cross-checked against cubing.js, which models the same puzzle from an
entirely independent definition. Directly comparing the arrays **failed**, and
correctly so — cubing.js stores the inverse mapping and labels slots in a
different order. Both models are internally consistent; they are different
coordinate systems for the same group, and neither is more right.

So the cross-check uses properties that do not depend on labelling:

- **Permutation order.** How many repetitions of an algorithm return the cube to
  solved depends on the whole group structure and not at all on naming. Two
  models agreeing on it for arbitrary algorithms are describing the same puzzle.
- **Solvedness.** Convention-independent, checked across random algorithms and
  their inverses so both answers actually occur.

The solver suite generates uniformly random *legal states* rather than scrambles,
which are on average harder, and verifies every solution by replaying it.

One practical trap worth recording: the suite must not import `cubing/scramble`.
That module runs its search in a worker which keeps the Node process alive after
the work finishes, so a test file importing it never exits — it hangs until
something kills it, which is indistinguishable from an infinitely slow solver.
That cost three ten-minute timeouts and a wrong diagnosis before I noticed the
one script that *worked* was the one using a hardcoded scramble.

## 11. What this is not

- **Not optimal.** Two-phase trades a provable minimum for speed. At the server's
  settings its mean of 18.93 moves is about 1.2 above the true average minimum:
  per Rokicki, Kociemba, Davidson and Dethridge's distance table (cube20.org),
  about two thirds of all positions need exactly 18 moves and about a quarter need
  17, which puts the average near 17.7. (An earlier version of this line compared
  the mean to God's number, 20 — but that is the worst case, not the typical one,
  so the comparison made the engine look closer to optimal than it is.) A
  genuinely optimal solver — IDA* over a much larger pattern database — would take
  minutes per cube for those last moves.
- **Not multi-puzzle.** 3x3 only. The coordinate scheme is specific to it.
- **Not incremental.** It solves a state; it does not resume or explain.
