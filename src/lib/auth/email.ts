/**
 * Turning what somebody typed into the one form the database stores.
 *
 * The `users.email` column carries `check (email = lower(email))`, so this is
 * not advice — a row that skipped this function is rejected by Postgres. That is
 * deliberate: normalisation that lives only in application code gets forgotten
 * at exactly one call site, and the symptom is two accounts for one person who
 * capitalised their address differently on a phone.
 */

/**
 * Lowercased and trimmed. Nothing else.
 *
 * In particular this does **not** strip `+tags` or dots, and that restraint is
 * the point. Doing so is a popular trick for stopping one person making many
 * accounts, and it is wrong twice over: `a.b@gmail.com` and `ab@gmail.com` are
 * the same mailbox at Google and different mailboxes almost everywhere else, so
 * the rule silently merges strangers' accounts on other providers. And plus-
 * addressing is a feature people rely on deliberately — it is how they filter
 * their mail and how they find out who sold their address.
 *
 * Mangling an address to enforce a policy nobody stated means mail sent to a
 * place the person did not ask for, and a reset link that never arrives.
 */
export function normaliseEmail(input: string): string {
  return input.trim().toLowerCase();
}

/**
 * Whether an address is worth trying to send to.
 *
 * Deliberately loose. The exhaustive grammar for an address (RFC 5322) admits
 * quoted strings, comments and nested parentheses; implementing it produces a
 * regex nobody can read that still cannot tell you whether mail will arrive.
 * The only real test of an address is sending to it, which is what verification
 * is for.
 *
 * So this rejects what is definitely not an address — no `@`, more than one,
 * nothing on either side, whitespace, no dot in the domain — and lets the mail
 * server judge the rest.
 */
export function isPlausibleEmail(email: string): boolean {
  if (email.length < 3 || email.length > 254) return false;
  if (/\s/.test(email)) return false;

  const at = email.indexOf("@");
  if (at <= 0 || at !== email.lastIndexOf("@")) return false;

  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (local.length === 0 || local.length > 64) return false;
  if (domain.length < 3 || domain.length > 253) return false;

  // A domain has to have a dot and cannot start or end with one, and no label
  // may be empty — which is what rules out `a@.com`, `a@com.` and `a@b..c`.
  if (!domain.includes(".")) return false;
  if (domain.startsWith(".") || domain.endsWith(".")) return false;
  if (domain.includes("..")) return false;
  if (domain.startsWith("-") || domain.endsWith("-")) return false;

  return true;
}

/**
 * The address as it should be shown back to a person.
 *
 * Long addresses break layouts, and truncating in the middle keeps both the
 * parts someone recognises: who it is and where it is. Cutting the end instead
 * would leave every address at a long domain looking identical.
 */
export function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return email;

  const local = email.slice(0, at);
  const domain = email.slice(at);
  if (local.length <= 2) return `${local[0] ?? ""}***${domain}`;
  return `${local.slice(0, 2)}${"*".repeat(Math.min(local.length - 2, 6))}${domain}`;
}
