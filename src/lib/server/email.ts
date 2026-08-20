import "server-only";

import { SITE_URL } from "../site";

/**
 * Sending mail, over Resend's HTTP API.
 *
 * Written as a `fetch` rather than by adding the `resend` package, for the same
 * reason the Svix signature check is written out: the dependency would be about
 * forty lines of convenience wrapping one POST, and this repository is meant to
 * be read. There is nothing here a reader has to take on trust.
 *
 * ## Sending never breaks the thing that triggered it
 *
 * Every function here reports failure by returning it, and no caller is
 * expected to fail a request because mail did not go out. Signing up works
 * whether or not the welcome message arrives; verifying an address is something
 * that can be retried.
 *
 * The one place that seems to want the opposite is password reset, and it does
 * not: telling somebody "we could not send that" is fine, but it must not
 * distinguish an address with no account from a mail provider having a bad
 * minute. See `emailTokens.ts` for how that is handled.
 *
 * ## Unconfigured is a supported state
 *
 * With no `RESEND_API_KEY`, nothing is sent and the link is written to the
 * server log instead. That is deliberate and it is what makes the whole flow
 * developable: a reset can be walked end to end on a laptop with no mail
 * provider, no domain and no account. It is also why `SEND_MODE` is reported
 * back to the caller — a silent no-op that looks like a success is how a broken
 * mail path survives to production.
 */

const RESEND_ENDPOINT = "https://api.resend.com/emails";

/**
 * Who mail comes from.
 *
 * `onboarding@resend.dev` is Resend's shared sender, which works with no domain
 * verified at all. It is the right default for a site with no domain yet, and
 * it is genuinely worse: shared senders have shared reputation, so some of this
 * will land in spam. Set `EMAIL_FROM` once there is a domain to verify.
 */
const FROM = process.env.EMAIL_FROM ?? "cubeduel <onboarding@resend.dev>";

export type SendMode = "sent" | "logged" | "failed";

export interface SendResult {
  mode: SendMode;
  /** Present when `mode` is "failed", for the server log rather than the user. */
  error?: string;
}

export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

interface Message {
  to: string;
  subject: string;
  text: string;
  html: string;
}

async function send(message: Message): Promise<SendResult> {
  const key = process.env.RESEND_API_KEY;

  if (!key) {
    // Not a silent success. The link goes to the log so the flow is walkable
    // locally, and the caller is told this is what happened.
    console.warn(
      `[email] RESEND_API_KEY is not set — not sending. Message for ${message.to}:\n${message.text}`,
    );
    return { mode: "logged" };
  }

  try {
    const response = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        html: message.html,
      }),
      // Without a timeout this inherits the platform default, which on a
      // serverless function means a hanging provider holds the request until
      // the function itself is killed — and the person sees a timeout on the
      // page rather than the thing they asked for.
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      return { mode: "failed", error: `${response.status} ${body.slice(0, 300)}` };
    }
    return { mode: "sent" };
  } catch (cause) {
    return {
      mode: "failed",
      error: cause instanceof Error ? cause.message : "unknown transport failure",
    };
  }
}

/**
 * Wraps body text in the least markup that still renders decently.
 *
 * No images, no external stylesheet, no web fonts — every one of those is
 * blocked by default in most mail clients, and a message that depends on them
 * arrives looking broken. Inline styles only, because mail clients strip
 * `<style>` blocks. The plain-text version is not a fallback nobody reads; it
 * is what a screen reader and a text client actually get.
 */
function shell(heading: string, body: string, action?: { label: string; url: string }): string {
  const button = action
    ? `<p style="margin:32px 0;">
         <a href="${action.url}" style="background:#f2f2f3;color:#0a0a0b;border-radius:8px;padding:12px 24px;text-decoration:none;font-weight:500;display:inline-block;">${action.label}</a>
       </p>
       <p style="color:#8a8a95;font-size:13px;line-height:1.6;">Or paste this into your browser:<br><span style="color:#8a8a95;word-break:break-all;">${action.url}</span></p>`
    : "";

  return `<div style="background:#0a0a0b;color:#f2f2f3;font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;padding:40px 24px;">
  <div style="max-width:480px;margin:0 auto;">
    <p style="font-size:15px;font-weight:600;letter-spacing:-0.01em;margin:0 0 32px;">cubeduel</p>
    <h1 style="font-size:22px;font-weight:500;letter-spacing:-0.02em;margin:0 0 16px;">${heading}</h1>
    <div style="color:#c8c8cf;font-size:15px;line-height:1.65;">${body}</div>
    ${button}
  </div>
</div>`;
}

/** The link that confirms an address is real. */
export function sendVerificationEmail(to: string, token: string): Promise<SendResult> {
  const url = `${SITE_URL}/verify?token=${encodeURIComponent(token)}`;

  return send({
    to,
    subject: "Confirm your cubeduel address",
    text: [
      "Confirm your address so you can get back into your account if you lose your passkey.",
      "",
      url,
      "",
      "The link works once and expires in an hour.",
      "If you didn't sign up for cubeduel, ignore this — no account will be affected.",
    ].join("\n"),
    html: shell(
      "Confirm your address",
      `<p style="margin:0;">This is what lets you back into your account if you lose your passkey. Without it, there is no way for us to prove the account is yours.</p>
       <p style="margin:16px 0 0;color:#8a8a95;font-size:13px;">The link works once and expires in an hour. If you didn't sign up for cubeduel, ignore this — no account will be affected.</p>`,
      { label: "Confirm address", url },
    ),
  });
}

/** The link that lets somebody set a new password. */
export function sendPasswordResetEmail(to: string, token: string): Promise<SendResult> {
  const url = `${SITE_URL}/reset?token=${encodeURIComponent(token)}`;

  return send({
    to,
    subject: "Reset your cubeduel password",
    text: [
      "Somebody asked to reset the password on this address.",
      "",
      url,
      "",
      "The link works once and expires in thirty minutes.",
      "Using it signs out every device currently signed in.",
      "If this wasn't you, ignore it — nothing has changed and nothing will.",
    ].join("\n"),
    html: shell(
      "Reset your password",
      `<p style="margin:0;">Somebody asked to reset the password on this address.</p>
       <p style="margin:16px 0 0;color:#8a8a95;font-size:13px;">The link works once and expires in thirty minutes, and using it signs out every device currently signed in. If this wasn't you, ignore it — nothing has changed and nothing will.</p>`,
      { label: "Set a new password", url },
    ),
  });
}

/**
 * Tells somebody their password changed.
 *
 * Sent after the fact and impossible to turn off, because this is the message
 * that makes a stolen account survivable. Somebody who did not do this needs to
 * find out immediately, and the only channel we are sure still reaches them is
 * the address on file.
 */
export function sendPasswordChangedEmail(to: string): Promise<SendResult> {
  return send({
    to,
    subject: "Your cubeduel password was changed",
    text: [
      "The password on your cubeduel account was just changed, and every signed-in device was signed out.",
      "",
      "If that was you, there is nothing to do.",
      "",
      "If it wasn't, reset your password now — whoever did it has been signed out too:",
      `${SITE_URL}/forgot`,
    ].join("\n"),
    html: shell(
      "Your password was changed",
      `<p style="margin:0;">The password on your account was just changed, and every signed-in device was signed out.</p>
       <p style="margin:16px 0 0;">If that was you, there is nothing to do. If it wasn't, reset it now — whoever did this has been signed out too.</p>`,
      { label: "Reset your password", url: `${SITE_URL}/forgot` },
    ),
  });
}

/**
 * Tells somebody a passkey was added to their account.
 *
 * Same reasoning as the password notice. A passkey added by somebody else is a
 * permanent way into the account that leaves no other trace — no password
 * changed, no session that looks unusual — so it is exactly the event that has
 * to be announced out of band.
 */
export function sendPasskeyAddedEmail(to: string, label: string | null): Promise<SendResult> {
  const named = label ? `"${label}"` : "A new passkey";

  return send({
    to,
    subject: "A passkey was added to your cubeduel account",
    text: [
      `${named} was just added to your cubeduel account.`,
      "",
      "If that was you, there is nothing to do.",
      "",
      "If it wasn't, remove it and sign out everywhere:",
      `${SITE_URL}/settings`,
    ].join("\n"),
    html: shell(
      "A passkey was added",
      `<p style="margin:0;">${named} was just added to your cubeduel account.</p>
       <p style="margin:16px 0 0;">If that was you, there is nothing to do. If it wasn't, remove it and sign out everywhere — a passkey you did not add is a permanent way in.</p>`,
      { label: "Open settings", url: `${SITE_URL}/settings` },
    ),
  });
}
