/**
 * Checks the repository's claims against the repository.
 *
 *   npm run audit
 *
 * Every check here exists because the thing it checks was actually wrong at
 * some point, and in every case the code compiled, the tests passed, and
 * nothing anywhere reported a problem:
 *
 *   - `/forgot`, `/reset` and `/verify` were linked from the sign-in page and
 *     from two emails and **did not exist**. Password reset was a feature that
 *     lived only in an integration test, and every verification email sent
 *     somebody to a 404.
 *   - Two analytics events were on the allowlist and emitted by nothing.
 *   - The README claimed 345 unit tests and 11 browser suites when there were
 *     460 and 12.
 *   - A comment described `revokeSessionById` as "what the device list's sign
 *     out acts on" while nothing called it.
 *
 * The common shape is a claim that outlived the thing it described. Types
 * cannot catch any of it, because nothing here is a type error.
 *
 * ## Every check must be able to fail
 *
 * There are no warnings. A check that reports a problem without failing gets
 * read as a pass, and this project has shipped that mistake before — five
 * honesty guards, all running, none able to fail. If something here is not
 * worth failing the build over, it does not belong.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const failures: string[] = [];

function fail(message: string) {
  failures.push(message);
}

function read(relative: string): string {
  return readFileSync(join(root, relative), "utf8");
}

function walk(dir: string, match: (name: string) => boolean): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(root, dir))) {
    const relative = `${dir}/${entry}`;
    if (statSync(join(root, relative)).isDirectory()) out.push(...walk(relative, match));
    else if (match(entry)) out.push(relative);
  }
  return out;
}

const sourceFiles = [
  ...walk("src", (n) => n.endsWith(".ts") || n.endsWith(".tsx")),
  ...walk("e2e", (n) => n.endsWith(".py")),
  ...walk("scripts", (n) => n.endsWith(".mts") || n.endsWith(".mjs")),
];
const allSource = sourceFiles.map(read).join("\n");

// ---------------------------------------------------------------------------
console.log("Every internal link points at a page that exists");
// ---------------------------------------------------------------------------
{
  const pages = new Set(
    walk("src/app", (n) => n === "page.tsx").map((p) =>
      p.replace("src/app", "").replace("/page.tsx", "") || "/",
    ),
  );

  const linked = new Set(
    [...allSource.matchAll(/href="(\/[a-z0-9/_-]*)"/g)].map((m) => m[1]),
  );

  for (const link of linked) {
    // Dynamic segments are matched by pattern rather than by name.
    const matches = [...pages].some((page) => {
      if (page === link) return true;
      const pattern = new RegExp(`^${page.replace(/\[[^\]]+\]/g, "[^/]+")}$`);
      return pattern.test(link);
    });
    if (!matches) fail(`Link to ${link} but no page renders it.`);
  }
  console.log(`  ${linked.size} distinct links, ${pages.size} pages`);
}

// ---------------------------------------------------------------------------
console.log("Every fetched API path has a route handler");
// ---------------------------------------------------------------------------
{
  const routes = new Set(
    walk("src/app/api", (n) => n === "route.ts").map((p) =>
      p.replace("src/app", "").replace("/route.ts", ""),
    ),
  );

  const called = new Set(
    [...allSource.matchAll(/['"`](\/api\/[a-z0-9/_-]+)['"`]/g)].map((m) => m[1]),
  );

  for (const path of called) {
    if (!routes.has(path)) fail(`Something fetches ${path} but no route handler exists.`);
  }
  console.log(`  ${called.size} distinct API calls, ${routes.size} routes`);
}

// ---------------------------------------------------------------------------
console.log("Every analytics event on the allowlist is emitted by something");
// ---------------------------------------------------------------------------
{
  const list = read("src/lib/analyticsEvents.ts");
  const names = [...list.matchAll(/^\s*"([a-z_]+)",$/gm)].map((m) => m[1]);
  if (names.length === 0) fail("Could not read the analytics allowlist — has its shape changed?");

  for (const name of names) {
    const emitted = new RegExp(`track(?:Once)?\\("${name}"`).test(allSource);
    if (!emitted) {
      fail(`Event "${name}" is on the allowlist and nothing emits it.`);
    }
  }
  console.log(`  ${names.length} events, all emitted`);
}

// ---------------------------------------------------------------------------
console.log("Every file an npm script names exists");
// ---------------------------------------------------------------------------
{
  const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
  let checked = 0;
  for (const [name, command] of Object.entries(pkg.scripts)) {
    for (const m of command.matchAll(/(?:^|\s)((?:scripts|e2e)\/[A-Za-z0-9._-]+)/g)) {
      checked++;
      if (!existsSync(join(root, m[1]))) fail(`Script "${name}" runs ${m[1]}, which does not exist.`);
    }
  }
  console.log(`  ${checked} referenced files`);
}

// ---------------------------------------------------------------------------
console.log("Every path the docs name exists");
// ---------------------------------------------------------------------------
{
  let checked = 0;
  for (const doc of ["README.md", "SECURITY.md", "CONTRIBUTING.md"]) {
    if (!existsSync(join(root, doc))) continue;
    const text = read(doc);
    const pattern =
      /`((?:src|scripts|e2e|supabase)\/[A-Za-z0-9/_.\-]+\.(?:ts|tsx|sql|mts|mjs|py))`/g;
    for (const m of text.matchAll(pattern)) {
      checked++;
      if (!existsSync(join(root, m[1]))) fail(`${doc} names ${m[1]}, which does not exist.`);
    }
  }
  console.log(`  ${checked} referenced paths`);
}

// ---------------------------------------------------------------------------
console.log("Every browser suite is in `npm run e2e`");
// ---------------------------------------------------------------------------
{
  const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
  const listed = new Set(pkg.scripts.e2e.match(/e2e\/[A-Za-z0-9]+\.py/g) ?? []);

  for (const suite of readdirSync(join(root, "e2e"))) {
    if (!suite.endsWith(".py")) continue;
    // `account.py` is a shared helper, and `https.py` needs its own production
    // build so it has its own script. Both are named here rather than skipped
    // by a pattern, so a third exception has to be a deliberate edit.
    if (suite === "account.py" || suite === "https.py") continue;
    if (!listed.has(`e2e/${suite}`)) {
      fail(`e2e/${suite} exists but \`npm run e2e\` does not run it.`);
    }
  }
  console.log(`  ${listed.size} suites wired up`);
}

// ---------------------------------------------------------------------------
console.log("The README's counts match reality");
// ---------------------------------------------------------------------------
{
  const readme = read("README.md");

  const claimedTests = Number(/\|\s*`npm test`\s*\|\s*(\d+) unit tests/.exec(readme)?.[1]);
  const claimedSuites = Number(/\|\s*`npm run e2e`\s*\|\s*(\d+) browser suites/.exec(readme)?.[1]);

  if (!claimedTests || !claimedSuites) {
    fail("Could not find the test counts in the README — has the table changed shape?");
  } else {
    // Run the suite rather than counting `test(` calls in the source: the
    // number the README claims is the number the runner reports, and a static
    // count would drift from it the first time a test is table-driven.
    const output = execFileSync("npm", ["test"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const actualTests = Number(/^[ℹ#] tests (\d+)$/m.exec(output)?.[1]);

    const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
    const actualSuites = (pkg.scripts.e2e.match(/e2e\/[A-Za-z0-9]+\.py/g) ?? []).length;

    if (!actualTests) fail("Could not read the test count from the runner's output.");
    else if (actualTests !== claimedTests) {
      fail(`README claims ${claimedTests} unit tests; there are ${actualTests}.`);
    }
    if (actualSuites !== claimedSuites) {
      fail(`README claims ${claimedSuites} browser suites; \`npm run e2e\` runs ${actualSuites}.`);
    }
    console.log(`  ${actualTests} unit tests, ${actualSuites} browser suites`);
  }
}

// ---------------------------------------------------------------------------

if (failures.length > 0) {
  console.error(`\nAudit FAILED — ${failures.length} claim(s) the repository does not support:\n`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

console.log("\nAudit passed. Every claim checked is one the repository supports.");
process.exit(0);
