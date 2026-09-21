#!/usr/bin/env node
/**
 * Every integration suite, one after another, against the local database.
 *
 *   npm run integration:local        fresh database + every suite
 *   npm run integration:all          every suite, database already up
 *
 * The suites are FOUND, not listed. A list is one more place a new suite has to
 * be added by hand, and this repository has a long record of the second half of
 * a two-part change being forgotten — a route with no sitemap entry, a page
 * linked from two emails that did not exist. A new `scripts/integration-*.mts`
 * runs here the moment it is committed.
 *
 * It refuses to run against anything but a local database unless told to. These
 * suites create and delete accounts; pointed at production they write into the
 * tables real players live in, and a suite that dies halfway leaves its rows
 * there. That used to be the only way to run them.
 */

import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPTS = join(ROOT, "scripts");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const local = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(url);

if (!url) {
  console.error("NEXT_PUBLIC_SUPABASE_URL is not set. Use `npm run integration:local`.");
  process.exit(1);
}
if (!local && process.env.CUBEDUEL_ALLOW_REMOTE_INTEGRATION !== "1") {
  console.error(
    `Refusing to run the integration suites against ${new URL(url).host}.\n` +
      "They create and delete accounts. Use `npm run integration:local`, or set\n" +
      "CUBEDUEL_ALLOW_REMOTE_INTEGRATION=1 if a hosted database is really intended.",
  );
  process.exit(1);
}

const found = readdirSync(SCRIPTS)
  .filter((name) => /^integration-[a-z0-9-]+\.mts$/.test(name))
  .sort();

// `npm run integration:rush` and friends name one suite. Naming one that does
// not exist is an error rather than "0 suites, all passed", which would read as
// a pass for a script whose file was renamed out from under it.
const requested = process.argv.slice(2);
const missing = requested.filter((name) => !found.includes(name));
if (missing.length > 0) {
  console.error(`No such integration suite: ${missing.join(", ")}`);
  process.exit(1);
}
const suites = requested.length > 0 ? requested : found;

const results = [];
for (const suite of suites) {
  const started = Date.now();
  console.log(`\n=== ${suite}`);
  const run = spawnSync("npx", ["tsx", join(SCRIPTS, suite)], {
    cwd: ROOT,
    stdio: "inherit",
    env: {
      ...process.env,
      // `server-only` throws unless it is resolved under the react-server condition.
      NODE_OPTIONS: [process.env.NODE_OPTIONS, "--conditions=react-server"].filter(Boolean).join(" "),
    },
  });
  results.push({ suite, ok: run.status === 0, seconds: (Date.now() - started) / 1000 });
}

console.log("\n=== integration summary");
for (const { suite, ok, seconds } of results) {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${suite.padEnd(34)} ${seconds.toFixed(1).padStart(6)}s`);
}
const failed = results.filter((r) => !r.ok).length;
const noun = results.length === 1 ? "suite" : "suites";
console.log(failed === 0 ? `\nAll ${results.length} ${noun} passed.` : `\n${failed} of ${results.length} ${noun} failed.`);
process.exit(failed === 0 ? 0 : 1);
