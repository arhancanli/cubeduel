import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

/**
 * Two React Compiler rules are switched off in specific places, and this comment
 * is the justification. Both were left firing for a while, which is worse than
 * either fixing them or recording why they stay — unexplained lint noise trains
 * people to run `lint` and ignore the output.
 *
 * Everything else in the React Compiler ruleset is left on. In particular
 * `react-hooks/refs` caught a real problem here (nine "latest value" refs being
 * written during render, which a discarded concurrent render can leave stale) and
 * that was fixed properly, in `src/lib/useLatest.ts`, rather than silenced.
 */
const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),

  {
    /**
     * `set-state-in-effect` — off for the screens that read local storage.
     *
     * Every instance is the same shape: set state in a mount effect from
     * `localStorage`, `navigator` or `matchMedia`. That is not an accident here,
     * it is the architecture — this app is offline-first and local storage is the
     * source of truth, so most screens genuinely have no data until the client
     * runs. Reading it during render instead would make the server and client
     * trees disagree and React would throw away the hydrated tree.
     *
     * The rule's objection is the extra render, and its preferred answer is
     * `useSyncExternalStore`. That does not fit: `getSnapshot` must return a
     * cached value, and every reader here (`loadHistory()`, `loadState()`,
     * `readDailyStats()`) builds a fresh array or object per call, which
     * infinite-loops. Making them cache-stable is a real refactor of storage
     * itself — worth doing when storage next changes, not worth destabilising
     * six e2e-verified screens for one extra render on mount.
     */
    files: [
      "src/components/AccountPanel.tsx",
      "src/components/ClaimScreen.tsx",
      "src/components/ClubsScreen.tsx",
      "src/components/CubePicker.tsx",
      "src/components/CubeView.tsx",
      "src/components/DailyRound.tsx",
      "src/components/GoalPanel.tsx",
      "src/components/LandingScreen.tsx",
      "src/components/ProgressScreen.tsx",
      "src/components/Reveal.tsx",
      "src/components/SignInScreen.tsx",
      "src/components/TimerScreen.tsx",
      "src/components/TrainScreen.tsx",
      "src/lib/useSolveSession.ts",
    ],
    rules: { "react-hooks/set-state-in-effect": "off" },
  },

  {
    /**
     * `immutability` — off for the two timer hooks.
     *
     * Both hits are the same self-referential `requestAnimationFrame` loop: a
     * `useCallback` that schedules itself for the next frame. It is the standard
     * shape for a rAF loop, and it is what paints the running clock straight into
     * a DOM node instead of re-rendering the screen sixty times a second.
     *
     * Restructuring it to satisfy the rule means moving the loop behind another
     * ref, which is strictly harder to read, in the most performance-sensitive
     * and most thoroughly e2e-covered code in the app. That is a bad trade.
     */
    files: ["src/lib/useSolveSession.ts", "src/lib/useSpeedTimer.ts"],
    rules: { "react-hooks/immutability": "off" },
  },
]);

export default eslintConfig;
