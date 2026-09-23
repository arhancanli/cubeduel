import Link from "next/link";

import { Glyph } from "@/components/Glyph";
import { SiteHeader, type NavKey } from "@/components/SiteHeader";
import { faceFor, stickerVar, type FaceKey } from "@/lib/modes";

/**
 * The door to a mode you cannot use yet.
 *
 * It used to be one grey sentence in the middle of an empty page, which read as
 * "this is broken" rather than "this is one step away". It now shows the mode —
 * its face, its colour, what it is — and puts the step that opens it in the one
 * green button, with the account-free alternative beside it.
 */
export function ModeGate({
  face,
  active,
  title,
  children,
  signIn,
}: {
  face: FaceKey;
  active: NavKey;
  title: string;
  children?: React.ReactNode;
  /** Where to come back to after signing in. Omit for an outage, not a gate. */
  signIn?: string;
}) {
  const mode = faceFor(face);
  return (
    <main className="flex min-h-dvh flex-col">
      <SiteHeader active={active} />
      <div className="flex flex-1 items-center justify-center px-4 py-10 sm:px-6">
        <section className="relative w-full max-w-lg overflow-hidden rounded-3xl border border-border bg-surface p-7 sm:p-10">
          <span
            aria-hidden="true"
            className="absolute inset-x-0 top-0 h-1.5"
            style={{ background: stickerVar(mode.sticker) }}
          />
          <div className="flex items-center gap-3">
            <Glyph pattern={mode.glyph} sticker={mode.sticker} size={36} />
            <span
              className="text-[11px] font-semibold uppercase tracking-[0.16em]"
              style={{ color: stickerVar(mode.sticker) }}
            >
              {mode.label}
            </span>
          </div>
          <h1 className="mt-6 text-balance text-3xl leading-tight sm:text-4xl">{title}</h1>
          <p className="mt-2 text-sm font-semibold text-foreground/80">{mode.blurb}</p>
          {children ? <p className="mt-4 text-base leading-relaxed text-muted">{children}</p> : null}
          {signIn ? (
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href={`/sign-in?next=${signIn}`} className="btn-go px-6 py-3 text-[15px]">
                Sign in or create an account
              </Link>
              <Link href="/play" className="btn-secondary px-5 py-3 text-[15px]">
                Practice instead
              </Link>
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}
