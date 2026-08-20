import type { Metadata } from "next";
import Link from "next/link";

import { SiteHeader } from "@/components/SiteHeader";

/**
 * What is collected, in the words of somebody who has to live with it.
 *
 * Written as specifics rather than as the usual document that reserves every
 * right and describes nothing. Every claim below is checkable against a named
 * file or a column that does not exist, which is the only kind of privacy
 * statement worth writing: "we do not store your IP address" means little, and
 * "the table has no column for one" can be verified in a public repository.
 */
export const metadata: Metadata = {
  title: "Privacy · cubeduel",
  description:
    "What cubeduel collects, what it does not, and how to be counted out entirely.",
};

export default function PrivacyPage() {
  return (
    <main className="flex min-h-dvh flex-col">
      <SiteHeader active="play" />

      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-6 pb-24 pt-10">
        <header className="flex flex-col gap-3">
          <h1 className="text-3xl font-medium tracking-tight">Privacy</h1>
          <p className="text-sm leading-relaxed text-muted">
            Short, specific, and checkable. cubeduel is open source, so every
            claim here points at a file you can read rather than asking you to
            take our word for it.
          </p>
        </header>

        <Section title="If you never make an account">
          <p>
            Your solves stay in your browser. Times, scrambles, move streams and
            everything the analysis is built from live in <code>localStorage</code>
            {" "}and are never sent anywhere. Clearing your browser data deletes
            them, and we cannot help you get them back, because we never had them.
          </p>
        </Section>

        <Section title="If you do make an account">
          <p>
            We store your email address, and either a password hash or the public
            half of a passkey. A password is hashed with scrypt and cannot be
            read back. A passkey&rsquo;s private half never leaves your device —
            we hold only the public key, which is useless to anyone who steals it.
          </p>
          <p>
            Your solves then sync so they follow you between devices, along with
            a handle and a rating. The handle and rating are public: that is what
            a ladder is.
          </p>
        </Section>

        <Section title="Measurement">
          <p>
            We count three things: whether people who arrive actually solve a
            cube, whether they come back, and whether they return the next day.
            Nothing else.
          </p>
          <p>
            It is entirely first-party. No third-party script is loaded, there is
            no advertising network, nothing is sold or shared, and there is no
            session recording. The identifier is a random value in{" "}
            <code>localStorage</code> — not a cookie, not a fingerprint, and not
            derived from anything about you. Clearing site data makes you a new
            visitor.
          </p>
          <p>
            <strong className="text-foreground">
              No IP address is recorded.
            </strong>{" "}
            The table has no column for one, which is a stronger guarantee than a
            promise.
          </p>
        </Section>

        <Section title="Being counted out">
          <p>
            If your browser sends <em>Do Not Track</em> or Global Privacy
            Control, no identifier is ever created and no event is ever sent.
            Nothing is sampled and nothing is anonymised, because nothing
            happens at all.
          </p>
          <p>
            Firefox and Brave send one of these by default. In most other
            browsers it is a single setting, and some privacy extensions send it
            for you.
          </p>
        </Section>

        <Section title="Deleting everything">
          <p>
            Deleting your account removes it and everything attached to it in one
            statement — solves, ratings, duels, challenges, sessions, passkeys
            and measurements — because every one of those has a foreign key that
            cascades. There is no soft delete and no recovery window.
          </p>
        </Section>

        <Section title="Cookies">
          <p>
            One, and only once you sign in: your session. It is{" "}
            <code>httpOnly</code>, <code>Secure</code>, and scoped to this site,
            and it holds a random value that means nothing anywhere else. There
            are no advertising or analytics cookies, which is why there is no
            banner asking you about them.
          </p>
        </Section>

        <footer className="flex flex-col gap-3 border-t border-border pt-6">
          <p className="text-xs leading-relaxed text-muted-dim">
            If something here is wrong, or the code does not match it, that is a
            bug and worth reporting. The repository is{" "}
            <Link
              href="https://github.com/arhancanli/cubeduel"
              className="text-muted underline underline-offset-4 transition-colors hover:text-foreground"
            >
              github.com/arhancanli/cubeduel
            </Link>
            .
          </p>
        </footer>
      </div>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-medium tracking-tight">{title}</h2>
      <div className="flex flex-col gap-3 text-sm leading-relaxed text-muted [&_code]:rounded [&_code]:bg-surface-hi [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-xs">
        {children}
      </div>
    </section>
  );
}
