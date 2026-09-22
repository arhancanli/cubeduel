/**
 * Where to go after signing in, when the page that sent somebody here said so.
 *
 * A race link opened by somebody without an account is the case that needs it:
 * they sign up, and landing on /progress instead of back in the race loses the
 * race. But a `?next=` that is followed blindly is an open redirect — a link to
 * this site's sign-in page that drops the person, signed in, on somebody else's.
 * So it is accepted only as a short path on this site: one leading slash, not
 * two (`//evil.example` is another host), no scheme, no backslash, no query.
 */
export function safeNext(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  if (!/^\/[a-z0-9][a-z0-9/_-]{0,99}$/i.test(value)) return null;
  if (value.includes("//")) return null;
  return value;
}

/** The `next` of the current address, read at the moment it is needed. */
export function nextFromLocation(fallback: string): string {
  if (typeof window === "undefined") return fallback;
  return safeNext(new URLSearchParams(window.location.search).get("next")) ?? fallback;
}
