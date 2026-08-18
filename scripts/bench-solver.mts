/**
 * How fast the solver actually is, on uniformly random cube states.
 *
 *   npm run bench:solver [count]
 *
 * Random *states*, not random scrambles. A scramble of N random moves does not
 * sample the group uniformly — short accidental cancellations make it easier
 * than a real position, and benchmarking on those flatters the search. This
 * builds a legal position directly: random permutations, random orientations,
 * then the three parity constraints repaired (corner twist ≡ 0 mod 3, edge flip
 * ≡ 0 mod 2, and matching permutation parity).
 *
 * Deliberately does not import `cubing/scramble`: anything that does never
 * exits, because its worker keeps the event loop alive.
 */
import { buildTables, solve, solvedCube, validate, type CubieCube } from "../src/lib/solver";
// `buildTables` is called explicitly so the one-off cost is measured separately
// rather than landing on whichever solve happened to be first.

const COUNT = Number(process.argv[2] ?? 100);

/** Mulberry32 — seeded so a run is reproducible and comparable across changes. */
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(arr: number[], rand: () => number): number[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function parity(perm: number[]): number {
  let swaps = 0;
  const p = [...perm];
  for (let i = 0; i < p.length; i++) {
    while (p[i] !== i) {
      const j = p[i];
      [p[i], p[j]] = [p[j], p[i]];
      swaps++;
    }
  }
  return swaps & 1;
}

function randomState(rand: () => number): CubieCube {
  const cube = solvedCube();
  const cp = shuffle([0, 1, 2, 3, 4, 5, 6, 7], rand);
  const ep = shuffle([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], rand);

  // Corner and edge permutation parity must agree; a single swap fixes it.
  if (parity(cp) !== parity(ep)) {
    [ep[0], ep[1]] = [ep[1], ep[0]];
  }
  cube.cp.set(cp);
  cube.ep.set(ep);

  // Orientations are free except for their sum.
  let twist = 0;
  for (let i = 0; i < 7; i++) {
    cube.co[i] = Math.floor(rand() * 3);
    twist += cube.co[i];
  }
  cube.co[7] = (3 - (twist % 3)) % 3;

  let flip = 0;
  for (let i = 0; i < 11; i++) {
    cube.eo[i] = Math.floor(rand() * 2);
    flip += cube.eo[i];
  }
  cube.eo[11] = flip % 2;

  return cube;
}

function quantile(sorted: number[], q: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
}

console.log(`\nBuilding tables…`);
const t0 = performance.now();
const tables = buildTables();
const buildMs = performance.now() - t0;
console.log(`  ready in ${buildMs.toFixed(0)}ms\n`);

const rand = rng(20260818);
const times: number[] = [];
const lengths: number[] = [];
let failed = 0;

console.log(`Solving ${COUNT} uniformly random states…`);
for (let i = 0; i < COUNT; i++) {
  const cube = randomState(rand);
  // `validate` returns the reason a cube is impossible, and null when it is
  // fine — so a truthy result is the failure, not the success.
  const illegal = validate(cube);
  if (illegal) throw new Error(`generated an illegal state at ${i}: ${illegal}`);

  const start = performance.now();
  const result = solve(cube);
  const ms = performance.now() - start;

  if (!result) {
    failed++;
    continue;
  }
  times.push(ms);
  lengths.push(result.length);
}

times.sort((a, b) => a - b);
lengths.sort((a, b) => a - b);
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

console.log(`\n== time per solve ==`);
console.log(`  median   ${quantile(times, 0.5).toFixed(1)}ms`);
console.log(`  mean     ${(sum(times) / times.length).toFixed(1)}ms`);
console.log(`  p95      ${quantile(times, 0.95).toFixed(1)}ms`);
console.log(`  p99      ${quantile(times, 0.99).toFixed(1)}ms`);
console.log(`  max      ${times[times.length - 1].toFixed(1)}ms`);
console.log(`  over 1s  ${times.filter((t) => t > 1000).length}/${times.length}`);
console.log(`  over 2s  ${times.filter((t) => t > 2000).length}/${times.length}`);

console.log(`\n== solution length (HTM) ==`);
console.log(`  mean     ${(sum(lengths) / lengths.length).toFixed(2)}`);
console.log(`  median   ${quantile(lengths, 0.5)}`);
console.log(`  max      ${lengths[lengths.length - 1]}`);
if (failed) console.log(`\n  ${failed} unsolved`);

console.log(`\n  table build ${buildMs.toFixed(0)}ms, once per process\n`);
process.exit(0);
