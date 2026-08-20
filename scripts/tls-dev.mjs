/**
 * Serves the local production build over real TLS.
 *
 * Two parts of authentication cannot be exercised over plain http, and both
 * fail *silently* when they are wrong:
 *
 * **The `__Host-` cookie prefix.** A browser refuses the cookie outright unless
 * it is `Secure`, carries no `Domain`, and is pathed at `/`. A refused cookie
 * is not an error anywhere — the response simply arrives with no session, so
 * every visitor appears signed out forever and nothing in any log says why.
 * Verified by breaking it on purpose: changing the path to `/settings` makes
 * the browser discard the cookie completely, and `e2e/https.py` goes from
 * twelve passes to reporting no cookies at all.
 *
 * **The relying party id**, which over http is always `localhost` and can
 * therefore never catch a value that carries a scheme or a port.
 *
 * Usage:
 *
 *   npm run build                       # with NEXT_PUBLIC_SITE_URL set to the https origin
 *   npm run start &
 *   node scripts/tls-dev.mjs &
 *   python3 e2e/https.py
 *
 * or simply `npm run e2e:https`, which does all of it.
 *
 * The certificate is self-signed and generated on first run into `.tls/`, which
 * `.gitignore` excludes (`*.pem`). Playwright is told to ignore the trust
 * error; the origin is still https, so the page is a secure context and every
 * cookie rule applies exactly as it would in production.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { request } from "node:http";
import { createServer } from "node:https";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, ".tls");
const keyPath = join(dir, "key.pem");
const certPath = join(dir, "cert.pem");

const UPSTREAM_PORT = Number(process.env.TLS_UPSTREAM_PORT ?? 3000);
const PORT = Number(process.env.TLS_PORT ?? 3443);

if (!existsSync(keyPath) || !existsSync(certPath)) {
  mkdirSync(dir, { recursive: true });
  const result = spawnSync(
    "openssl",
    [
      "req", "-x509", "-newkey", "rsa:2048",
      "-keyout", keyPath, "-out", certPath,
      "-days", "30", "-nodes",
      "-subj", "/CN=localhost",
      "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1",
    ],
    { stdio: "inherit" },
  );
  if (result.status !== 0) {
    console.error("Could not generate a certificate. Is openssl installed?");
    process.exit(1);
  }
}

const options = { key: readFileSync(keyPath), cert: readFileSync(certPath) };

createServer(options, (req, res) => {
  const upstream = request(
    {
      host: "127.0.0.1",
      port: UPSTREAM_PORT,
      path: req.url,
      method: req.method,
      headers: req.headers,
    },
    (up) => {
      res.writeHead(up.statusCode ?? 502, up.headers);
      up.pipe(res);
    },
  );

  // The upstream being down is the ordinary case while the build is still
  // starting. Answering 502 rather than crashing keeps the proxy up so the
  // suite's own retry finds it a moment later.
  upstream.on("error", () => {
    if (!res.headersSent) res.writeHead(502);
    res.end("upstream not ready");
  });

  req.pipe(upstream);
}).listen(PORT, () => {
  console.log(`TLS proxy: https://localhost:${PORT} -> 127.0.0.1:${UPSTREAM_PORT}`);
});
