#!/usr/bin/env node
/**
 * A throwaway copy of the production database, on this machine.
 *
 *   npm run db:up                    fresh database, every migration applied
 *   npm run db:down                  remove it
 *   node scripts/db-local.mjs run -- <command>
 *                                    run anything against it (tests, `next dev`)
 *
 * Why it exists. Every integration suite in this repository used to run against
 * the production project, because that was the only database there was. That
 * had two costs. The suites created and deleted accounts in the same tables real
 * players live in, so a suite that crashed halfway left its rows behind for
 * everyone to see. And the suites could only run while production was up — on
 * 2026-09-21 the hosted project had been paused for inactivity, and every one of
 * them was dead along with it.
 *
 * What it is: Postgres, PostgREST, and a gateway that serves PostgREST under
 * `/rest/v1` the way Supabase does. That is the whole of Supabase this
 * application touches — identity is its own, there is no storage, no realtime,
 * no edge functions — so `@supabase/supabase-js` cannot tell the difference.
 *
 * The part that has to be faithful is not the tables, which the migrations
 * create. It is what Supabase does BEFORE any migration runs: the roles, and the
 * default privileges that hand `anon` and `authenticated` their own EXECUTE on
 * every function the moment it is created. That default is why `REVOKE ... FROM
 * public` once protected nothing here (see 0001_initial_schema.sql). A local
 * database without it would make that exploit impossible to reproduce, and a
 * test that cannot reproduce a bug cannot prove it fixed.
 *
 * Every `up` starts from an empty database. A suite that passes here has passed
 * against the migrations as committed, not against whatever an earlier run left.
 *
 * Needs Docker. Honours DOCKER_CONTEXT, so it can run against any engine.
 */

import { spawnSync, spawn } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATIONS = join(ROOT, "supabase", "migrations");
const ENV_FILE = join(ROOT, ".env.test.local");

const NETWORK = "cubeduel-local";
const DB = "cubeduel-local-db";
const REST = "cubeduel-local-rest";
const GATEWAY = "cubeduel-local-gateway";

// Supabase's own local ports, so anything written for `supabase start` works.
const GATEWAY_PORT = 54321;
const DB_PORT = 54322;

const POSTGRES_IMAGE = "postgres:17-alpine"; // production runs 17
const POSTGREST_IMAGE = "postgrest/postgrest:v12.2.3";
const GATEWAY_IMAGE = "nginx:1.27-alpine";

/**
 * What Supabase sets up before a project's first migration, reduced to the parts
 * that change behaviour. Taken from Supabase's published role setup
 * (supabase/postgres, migrations/db/init-scripts), not reconstructed by guessing.
 */
const BOOTSTRAP_SQL = `
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;
create role authenticator login noinherit password '${"local-only"}';
grant anon, authenticated, service_role to authenticator;

grant usage on schema public to anon, authenticated, service_role;

-- The defaults that matter. Every table, sequence and FUNCTION created by the
-- migration role is granted to all three API roles automatically. RLS is what
-- stands between anon and a table; for a function, only an explicit revoke does.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
`;

function docker(args, { input, allowFailure = false, quiet = true } = {}) {
  const result = spawnSync("docker", args, {
    input,
    encoding: "utf8",
    stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
  });
  if (result.error) {
    throw new Error(`docker could not be run: ${result.error.message}. Is Docker installed?`);
  }
  if (result.status !== 0 && !allowFailure) {
    throw new Error(`docker ${args.slice(0, 3).join(" ")} failed:\n${result.stderr || result.stdout}`);
  }
  if (!quiet && result.stdout) process.stdout.write(result.stdout);
  return result;
}

function base64url(buffer) {
  return Buffer.from(buffer).toString("base64url");
}

/** The legacy `service_role` key shape: an HS256 JWT PostgREST verifies itself. */
function serviceRoleKey(secret) {
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64url(
    JSON.stringify({ role: "service_role", iss: "cubeduel-local", iat: Math.floor(Date.now() / 1000) }),
  );
  const signature = createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${signature}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(label, probe, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await probe()) return;
    if (Date.now() > deadline) throw new Error(`${label} did not become ready within ${timeoutMs / 1000}s`);
    await sleep(500);
  }
}

function down() {
  for (const name of [GATEWAY, REST, DB]) docker(["rm", "-f", name], { allowFailure: true });
  docker(["network", "rm", NETWORK], { allowFailure: true });
}

function psql(sql, label) {
  const result = docker(
    ["exec", "-i", DB, "psql", "-v", "ON_ERROR_STOP=1", "-q", "-U", "postgres", "-d", "postgres"],
    { input: sql, allowFailure: true },
  );
  if (result.status !== 0) {
    throw new Error(`${label} failed to apply:\n${result.stderr}`);
  }
}

async function up() {
  down();

  const jwtSecret = randomBytes(32).toString("hex");
  const key = serviceRoleKey(jwtSecret);

  docker(["network", "create", NETWORK]);
  docker([
    "run", "-d", "--name", DB, "--network", NETWORK,
    "-e", "POSTGRES_PASSWORD=local-only",
    "-p", `127.0.0.1:${DB_PORT}:5432`,
    POSTGRES_IMAGE,
  ]);

  // The image initialises with a temporary server, then shuts it down and starts
  // the real one. The temporary server listens only on the Unix socket — which
  // is what `docker exec psql` uses by default — so a query over the socket can
  // succeed during init and the next statement land on a server that is
  // shutting down ("terminating connection due to administrator command"). That
  // happened in CI. Over TCP only the real server answers, so the probe asks
  // over TCP.
  await waitFor("Postgres", () =>
    docker(["exec", DB, "psql", "-h", "127.0.0.1", "-U", "postgres", "-tAc", "select 1"], {
      allowFailure: true,
    }).status === 0,
  );

  psql(BOOTSTRAP_SQL, "the Supabase role setup");

  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    psql(readFileSync(join(MIGRATIONS, file), "utf8"), file);
  }
  console.log(`applied ${files.length} migrations (${files[0]} … ${files.at(-1)})`);

  // Started after the migrations so its schema cache is built from the real schema.
  docker([
    "run", "-d", "--name", REST, "--network", NETWORK,
    "-e", `PGRST_DB_URI=postgres://authenticator:local-only@${DB}:5432/postgres`,
    "-e", "PGRST_DB_SCHEMAS=public",
    "-e", "PGRST_DB_ANON_ROLE=anon",
    "-e", `PGRST_JWT_SECRET=${jwtSecret}`,
    POSTGREST_IMAGE,
  ]);

  // Written inside the container rather than mounted, because a bind mount
  // depends on which host paths the Docker VM happens to share.
  const gatewayConfig = [
    "server {",
    "  listen 80;",
    "  client_max_body_size 5m;",
    "  location /rest/v1/ {",
    `    proxy_pass http://${REST}:3000/;`,
    "    proxy_set_header Host $host;",
    "  }",
    "}",
  ].join("\n");
  docker([
    "run", "-d", "--name", GATEWAY, "--network", NETWORK,
    "-p", `127.0.0.1:${GATEWAY_PORT}:80`,
    "--entrypoint", "sh",
    GATEWAY_IMAGE,
    "-c", `printf '%s\\n' '${gatewayConfig}' > /etc/nginx/conf.d/default.conf && exec nginx -g 'daemon off;'`,
  ]);

  const url = `http://127.0.0.1:${GATEWAY_PORT}`;
  await waitFor("PostgREST", async () => {
    try {
      const response = await fetch(`${url}/rest/v1/profiles?select=id&limit=1`, {
        headers: { apikey: key, Authorization: `Bearer ${key}` },
      });
      return response.ok;
    } catch {
      return false;
    }
  });

  // Prove the thing that makes this a copy of production rather than a database:
  // an anonymous request sees nothing. On an EMPTY table that proves nothing —
  // an empty readable table also returns [] — so a row goes in first.
  psql("insert into users (email) values ('rls-probe@cubeduel.test');", "the RLS probe row");
  const anonymous = await fetch(`${url}/rest/v1/users?select=id`);
  const leaked = anonymous.ok ? (await anonymous.json()).length : 0;
  psql("delete from users where email = 'rls-probe@cubeduel.test';", "the RLS probe cleanup");
  if (leaked !== 0) {
    throw new Error(`anon could read ${leaked} row(s) from users — RLS is not in force locally`);
  }

  writeFileSync(
    ENV_FILE,
    [
      "# Written by scripts/db-local.mjs. Points at the local database only.",
      `NEXT_PUBLIC_SUPABASE_URL=${url}`,
      `SUPABASE_SECRET_KEY=${key}`,
      "",
    ].join("\n"),
  );
  console.log(`local database ready at ${url} (credentials in .env.test.local)`);
}

/**
 * Runs a command with the local database's variables in its environment.
 *
 * Environment variables win over `--env-file` in Node and over `.env.local` in
 * Next, so this overrides the hosted project without editing any file — and a
 * suite run this way cannot reach production by accident.
 */
function run(command) {
  if (!existsSync(ENV_FILE)) {
    console.error("No local database. Run `npm run db:up` first.");
    process.exit(1);
  }
  const vars = {};
  for (const line of readFileSync(ENV_FILE, "utf8").split("\n")) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (match) vars[match[1]] = match[2];
  }
  const child = spawn(command[0], command.slice(1), {
    stdio: "inherit",
    env: { ...process.env, ...vars },
  });
  child.on("exit", (code, signal) => process.exit(signal ? 1 : (code ?? 1)));
}

const [verb, ...rest] = process.argv.slice(2);
try {
  if (verb === "up") await up();
  else if (verb === "down") {
    down();
    console.log("local database removed");
  } else if (verb === "run") {
    const command = rest[0] === "--" ? rest.slice(1) : rest;
    if (command.length === 0) throw new Error("usage: db-local.mjs run -- <command>");
    run(command);
  } else {
    throw new Error("usage: db-local.mjs up | down | run -- <command>");
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
