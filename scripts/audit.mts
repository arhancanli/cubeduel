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

import {
  ENUMERATED_DYNAMIC,
  EXCLUDED,
  INDEXABLE,
} from "../src/lib/sitemapRoutes.js";

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
/**
 * Source with comments removed.
 *
 * Every scan below looks for paths, and this codebase documents itself heavily
 * — including, inevitably, by naming paths in prose. Backtick-quoted inline
 * code in a doc comment looks exactly like a string literal to a regex, so
 * without this the audit reports that nothing serves `/api/v0/me` (the WCA's
 * endpoint, named in a comment explaining why we call it) and that a doc
 * mentioning a route is a broken link.
 *
 * That is the third time a guard in this repository has fired on its own
 * documentation. Stripping comments is the fix that does not require a growing
 * list of exceptions.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
    .replace(/^\s*#.*$/gm, " ");
}

const allSource = sourceFiles.map((f) => stripComments(read(f))).join("\n");

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

  // Route handlers are legitimate link targets too: `/api/wca/start` redirects
  // to the WCA, and an <a> is the right element for a navigation the server
  // performs. Collected here so a link to one is not reported as broken.
  const routeHandlers = new Set(
    walk("src/app/api", (n) => n === "route.ts").map((p) =>
      p.replace("src/app", "").replace("/route.ts", ""),
    ),
  );

  for (const link of linked) {
    if (routeHandlers.has(link)) continue;

    // Dynamic segments are matched by pattern rather than by name.
    const matches = [...pages].some((page) => {
      if (page === link) return true;
      const pattern = new RegExp(`^${page.replace(/\[[^\]]+\]/g, "[^/]+")}$`);
      return pattern.test(link);
    });
    if (!matches) fail(`Link to ${link} but nothing serves it.`);
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
console.log("Every path the docs name is one a clone actually has");
// ---------------------------------------------------------------------------
//
// Existence is not the check. A file can sit in the working tree, satisfy every
// `existsSync` here, and still be missing for everybody else — because it is
// gitignored, or was simply never added.
//
// That is not hypothetical: `.env.example` was caught by the `.env*` rule for
// this project's whole life, so the README's first setup step (`cp .env.example
// .env.local`) failed for every person who cloned it, while passing this audit
// on the machine where the file happened to exist.
{
  const tracked = new Set(
    execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" }).split("\n").filter(Boolean),
  );

  let checked = 0;
  const check = (doc: string, path: string) => {
    checked++;
    if (!existsSync(join(root, path))) {
      fail(`${doc} names ${path}, which does not exist.`);
    } else if (!tracked.has(path)) {
      fail(`${doc} tells you to use ${path}, but it is not committed — a clone will not have it.`);
    }
  };

  for (const doc of ["README.md", "SECURITY.md", "CONTRIBUTING.md"]) {
    if (!existsSync(join(root, doc))) continue;
    const text = read(doc);

    const sourcePaths =
      /`((?:src|scripts|e2e|supabase)\/[A-Za-z0-9/_.\-]+\.(?:ts|tsx|sql|mts|mjs|py))`/g;
    for (const m of text.matchAll(sourcePaths)) check(doc, m[1]);

    // Setup instructions. A `cp x y` in a README is a promise that x is there,
    // and those files live at the repo root where the pattern above never looks.
    // The leading char must allow a dot. Requiring alphanumeric here is what
    // let `.env.example` — the one file this check exists for — slip past it.
    const copied = /^\s*cp\s+(\.?[A-Za-z0-9][A-Za-z0-9/_.\-]*)\s/gm;
    for (const m of text.matchAll(copied)) check(doc, m[1]);
  }
  console.log(`  ${checked} referenced paths, all committed`);
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
console.log("Every page is either in the sitemap or excluded on purpose");
// ---------------------------------------------------------------------------
//
// Adding a route and adding it to the sitemap were two separate acts, connected
// by nothing. Eighty-two pages accumulated that the sitemap had never heard of —
// including the one page on this site aimed at somebody who cannot solve a cube
// at all, which is the single most searched thing in this subject.
//
// A page can still be left out. It just cannot be left out by accident.
{
  const routes = walk("src/app", (n) => n === "page.tsx")
    .map((p) => p.replace("src/app", "").replace("/page.tsx", ""))
    .map((p) => (p === "" ? "/" : p));

  const listed = new Set(INDEXABLE.map((r) => r.path));
  const excluded = new Set(Object.keys(EXCLUDED));
  const enumerated = new Set(ENUMERATED_DYNAMIC);

  for (const route of routes) {
    if (listed.has(route) || excluded.has(route) || enumerated.has(route)) continue;
    fail(
      `${route} is a page, but it is not in the sitemap and no reason is given for leaving it out.`,
    );
  }

  // The reverse: a sitemap entry for a page that no longer exists sends crawlers
  // to a 404 and quietly costs the whole file credibility.
  for (const route of listed) {
    if (!routes.includes(route)) {
      fail(`The sitemap lists ${route}, which is not a page.`);
    }
  }

  for (const [route, reason] of Object.entries(EXCLUDED)) {
    if (!reason.trim()) fail(`${route} is excluded from the sitemap with no reason.`);
  }

  console.log(`  ${routes.length} pages, ${listed.size} indexed, ${excluded.size} excluded with reasons`);
}

// ---------------------------------------------------------------------------
console.log("Every commit is the owner's, and credits nobody else");
// ---------------------------------------------------------------------------
{
  // This repository is somebody's work and somebody's record. Every commit must
  // be authored and committed by the owner, and must not carry a trailer
  // crediting a tool as a collaborator — an assistant is not a contributor, and
  // a `Co-Authored-By` on a public repository says otherwise permanently.
  //
  // Enforced rather than promised, because the history was wrong once already:
  // eighteen commits were attributed to a stale account and nine to nobody at
  // all, and nothing anywhere reported it. It was found by looking.
  const OWNER = "Arhan Canli <315329124+arhancanli@users.noreply.github.com>";

  const identities = execFileSync("git", ["log", "--format=%an <%ae>%n%cn <%ce>"], {
    cwd: root,
    encoding: "utf8",
  })
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const wrong = [...new Set(identities.filter((who) => who !== OWNER))];
  if (wrong.length > 0) {
    fail(`Commits credited to somebody other than the owner: ${wrong.join(", ")}`);
  }

  // Anchored to the start of a line, because a trailer is a line — and the
  // first version of this matched anywhere in the message, so it failed on the
  // commit that INTRODUCED it, which merely mentions the trailer in prose.
  // A guard that fires on its own disclaimer is a guard nobody keeps.
  const bodies = execFileSync("git", ["log", "--format=%B"], { cwd: root, encoding: "utf8" });
  const trailer = /^\s*(co-authored-by|signed-off-by\s*:.*(claude|anthropic)|generated with)\s*:/i;

  const offending = bodies
    .split("\n")
    .filter((line) => trailer.test(line))
    .slice(0, 3);

  if (offending.length > 0) {
    fail(`Commit messages credit a tool as a collaborator: ${offending.join(" / ")}`);
  }

  console.log(`  ${identities.length / 2} commits, all ${OWNER.split(" <")[0]}`);
}

// ---------------------------------------------------------------------------

if (failures.length > 0) {
  console.error(`\nAudit FAILED — ${failures.length} claim(s) the repository does not support:\n`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

console.log("\nAudit passed. Every claim checked is one the repository supports.");
process.exit(0);
