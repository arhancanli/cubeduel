# The solving engine

A from-scratch implementation of Kociemba's two-phase algorithm, in TypeScript,
in `src/lib/solver/`. This document is the reasoning: what the algorithm is, why
each piece is shaped the way it is, what was measured, and which of my first
attempts were wrong.

**Result.** Over 100 random-state scrambles: every cube solved, mean **20.65
moves** (half-turn metric), median **69ms**, maximum **815ms**. Tables build once
in ~750ms. That is short, not shortest: the average true minimum for a random
cube is about 17.7 moves, so these routes run about three moves long. See
[What this is not](#9-what-this-is-not).

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
metric: every cube is at most 20 moves from solved. Finding that 20-move solution
is expensive — optimal solvers can take minutes per cube. Almost nobody needs
optimal. They need short, now.

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

Pairs rather than the full triple purely for memory — the exact phase-one table
would need 2,187 × 2,048 × 495 ≈ 2.2 billion entries.

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

## 7. Measurements

100 random-state scrambles, laptop, tables pre-built.

| Options | Solved | Mean length | Median | p95 | Max |
|---|---|---|---|---|---|
| `targetLength: 22, timeBudgetMs: 100` | 100/100 | 21.62 | 42ms | 101ms | 168ms |
| **default** (`21`, `250ms`) | 100/100 | **20.65** | **69ms** | 251ms | 815ms |
| `targetLength: 20, timeBudgetMs: 1000` | 100/100 | 19.98 | 727ms | 1001ms | 1001ms |

Chasing an exact 20 costs roughly five times the time for less than a move,
because 20 is the diameter and the last move is the expensive one. The defaults
sit where the curve flattens.

Every solution in every run was verified by applying it and checking the cube
ended solved. A solver that returns plausible-looking moves which do not solve is
worse than one that returns nothing.

## 8. Testing

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

## 9. What this is not

- **Not optimal.** Two-phase trades a provable minimum for speed. Its mean of
  about 20.6 moves is roughly three above the true average minimum: per
  Rokicki, Kociemba, Davidson and Dethridge's distance table (cube20.org), about
  two thirds of all positions need exactly 18 moves and about a quarter need 17,
  which puts the average near 17.7. (An earlier version of this line compared
  the mean to God's number, 20 — but that is the worst case, not the typical
  one, so the comparison made the engine look closer to optimal than it is.) A
  genuinely optimal solver — IDA* over a much larger pattern database — would
  take minutes per cube for those last three moves.
- **Not multi-puzzle.** 3x3 only. The coordinate scheme is specific to it.
- **Not incremental.** It solves a state; it does not resume or explain.
