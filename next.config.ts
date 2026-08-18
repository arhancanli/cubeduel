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
   * If this is ever wrong the solver still works: the loader returns null on any
   * failure and the tables are computed instead. That costs about two seconds on
   * a cold start, which is exactly the regression this file exists to prevent,
   * so it is worth checking the deployed cold latency after touching it.
   */
  outputFileTracingIncludes: {
    "/api/**": [".solver-cache/**"],
  },
};

export default nextConfig;
