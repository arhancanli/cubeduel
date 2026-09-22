import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * `cubing` must not be bundled into the server output.
   *
   * Its random-state scramble generator runs the search in a worker backed by a
   * ~600KB WASM module, and it locates both by resolving paths relative to its
   * own files. Bundled and traced by the compiler, those paths no longer point
   * anywhere, and the worker never starts — it does not throw, it simply never
   * resolves. On Vercel that surfaced as `/api/ranked/attempt` hanging until
   * FUNCTION_INVOCATION_TIMEOUT, with no error anywhere to explain it.
   *
   * Measured on the deployment: `import("cubing/scramble")` succeeded in 15ms
   * and `randomScrambleForEvent("333")` never returned. `cubing/puzzles`, which
   * is pure JavaScript, was fine at 1ms — which is what pinned it on the worker
   * rather than on the package as a whole.
   *
   * Leaving it external makes Node load it from node_modules at runtime, with
   * its own file layout intact.
   */
  serverExternalPackages: ["cubing"],

  /**
   * The precomputed solver tables are read from disk at runtime, so they have to
   * be traced into the function bundle — nothing imports them, so the compiler
   * cannot see the dependency on its own.
   *
   * If this is ever wrong the solver still works, and that is the danger. The
   * loader returns null on any failure and the tables are computed instead,
   * which costs about two seconds on a cold start; the exact phase-one table is
   * not computed at all, and the search quietly falls back to the weaker pair
   * bounds. Both are silent. So `npm run audit` works out which routes actually
   * reach the solver and fails if this list is not exactly those — the 67MB
   * table is listed route by route rather than for `/api/**` because every
   * route named here carries its own copy into its bundle.
   */
  outputFileTracingIncludes: {
    "/api/solve": [".solver-cache/**"],
    "/api/duel/start": [".solver-cache/**"],
  },
};

export default nextConfig;
