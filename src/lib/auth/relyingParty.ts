import { SITE_URL } from "../site";

/**
 * Who this site says it is, to an authenticator.
 *
 * WebAuthn binds every passkey to a **relying party id** — a domain — and
 * checks it on both sides: the browser refuses to make a credential for a
 * domain the page is not on, and the server refuses an assertion whose
 * authenticator data hashes a different one. That double check is what stops a
 * passkey made here being usable anywhere else, and it is also the single
 * easiest thing to misconfigure into "passkeys are broken for everybody".
 *
 * Both values come from `SITE_URL`, which is how the deployment describes
 * itself — never from a request header. `Host` and `X-Forwarded-Host` are
 * attacker-supplied, and a relying party id taken from the request is a
 * relying party id the attacker chooses.
 *
 * ## Why these are two different strings
 *
 * The **origin** is scheme, host and port: `https://cubeduel.vercel.app`. It is
 * compared for exact equality against what the browser reports.
 *
 * The **id** is the bare domain: `cubeduel.vercel.app`. No scheme, no port.
 * Passing an origin where an id belongs produces credentials that nothing can
 * ever verify, and on real hardware only — which is exactly the class of bug
 * this file exists to make impossible to write by accident.
 *
 * The derivation is a pure function of the URL so that it can be tested against
 * the shapes that actually break it, rather than only against whatever this
 * deployment happens to be configured as.
 */

export interface RelyingParty {
  /** The bare domain. No scheme, no port. */
  id: string;
  /** Scheme, host and port, exactly as a browser reports it. */
  origin: string;
  /** Whether a browser will permit WebAuthn at this address at all. */
  usable: boolean;
}

/**
 * Derives both values from a site URL.
 *
 * Throws on a URL it cannot parse. `SITE_URL` is built from environment
 * variables, so a malformed one is a deployment mistake — and failing loudly
 * beats defaulting to something plausible and issuing credentials bound to a
 * domain nobody meant.
 */
export function deriveRelyingParty(siteUrl: string): RelyingParty {
  let url: URL;
  try {
    url = new URL(siteUrl);
  } catch {
    throw new Error(`SITE_URL is not a valid URL: ${siteUrl}`);
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`SITE_URL must be http or https, got ${url.protocol}`);
  }

  return {
    // `hostname` rather than `host` — the two differ only when a port is
    // present, which is exactly the case that matters locally, and
    // `localhost:3000` is not a valid relying party id while `localhost` is.
    id: url.hostname,

    // `url.origin` rather than the raw string, because the two differ on a
    // trailing slash and the comparison downstream is an equality check. A
    // SITE_URL of "https://cubeduel.vercel.app/" would otherwise never match
    // the "https://cubeduel.vercel.app" a browser sends, and every passkey on
    // the site would fail complaining about an origin that is in fact correct.
    origin: url.origin,

    // Browsers require a secure context, and treat localhost as one even over
    // plain http specifically so this is developable. Anything else on http —
    // a preview on a bare IP, a LAN address — cannot, and it is worth being
    // able to say so in the interface rather than letting the call fail with a
    // browser error nobody can act on.
    usable:
      url.protocol === "https:" ||
      url.hostname === "localhost" ||
      url.hostname === "127.0.0.1" ||
      url.hostname === "[::1]",
  };
}

/** What the passkey is labelled as in the operating system's prompt. */
export const RELYING_PARTY_NAME = "cubeduel";

export function relyingPartyId(): string {
  return deriveRelyingParty(SITE_URL).id;
}

export function relyingPartyOrigin(): string {
  return deriveRelyingParty(SITE_URL).origin;
}

export function canUsePasskeys(): boolean {
  return deriveRelyingParty(SITE_URL).usable;
}
