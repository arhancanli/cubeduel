"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { Glyph, Mark } from "@/components/Glyph";
import { faceFor, type FaceKey } from "@/lib/modes";
import { useSession } from "@/lib/useSession";

/**
 * The shell: one navigation for every screen.
 *
 * On a wide screen it is a sidebar, the way every serious game site is laid out —
 * the destinations stay put while the page changes beside them, and there is room
 * to say which half of the site each one belongs to. On a phone the same element
 * becomes a drawer behind a Menu button, and a tab bar across the bottom holds the
 * four places people actually go. It is one `<nav>` in both cases, so a screen
 * reader hears the same structure at any width.
 *
 * `fade` exists because the timer and the daily blank their chrome the instant a
 * solve starts — nothing but the clock should be on screen while someone is
 * solving, and that includes the nav and the account button.
 */
export type NavKey =
  /** The front page, which is not a destination in the nav. */
  | "home"
  | "timer"
  | "daily"
  | "play"
  | "ranked"
  | "duel"
  | "rush"
  | "train"
  | "solve"
  | "learn"
  | "cube"
  | "leaderboard"
  | "clubs"
  | "race"
  | "progress"
  | "review";

type Icon = { face: FaceKey } | { line: LineIconName };

interface NavLink {
  key: NavKey;
  href: string;
  label: string;
  icon: Icon;
}

/**
 * Two groups, because they are two different activities.
 *
 * **Compete** puts something on the record: a rating moves, a result is
 * published, an opponent is waiting. **Practice** does not — nothing there is
 * recorded against you, and that is the point of it.
 *
 * Separating them is not decoration: it is the difference between "everything
 * here is being judged" and "this bit is yours to fail in".
 */
const COMPETE: NavLink[] = [
  { key: "ranked", href: "/ranked", label: "Ranked", icon: { face: "ranked" } },
  // Second, because it is the one thing here that is two people at once.
  { key: "race", href: "/race", label: "Race", icon: { face: "race" } },
  { key: "rush", href: "/rush", label: "Rush", icon: { face: "rush" } },
  { key: "duel", href: "/duel", label: "Duel", icon: { face: "duel" } },
  { key: "daily", href: "/daily", label: "Daily", icon: { face: "daily" } },
  { key: "leaderboard", href: "/leaderboard", label: "Leaderboard", icon: { line: "podium" } },
  // Under Compete rather than Practice, because a club board ranks you against
  // people by the same verified solves the global one uses.
  { key: "clubs", href: "/clubs", label: "Clubs", icon: { line: "people" } },
];

const PRACTICE: NavLink[] = [
  { key: "play", href: "/play", label: "Play", icon: { line: "keys" } },
  { key: "timer", href: "/timer", label: "Timer", icon: { face: "solve" } },
  // The only entry that assumes nothing: every other page here takes it for
  // granted that you can already solve a cube.
  { key: "solve", href: "/solve", label: "How to solve", icon: { line: "book" } },
  // Learn is where you meet a case, Train is where you keep it.
  { key: "learn", href: "/learn", label: "Learn", icon: { line: "cases" } },
  { key: "train", href: "/train", label: "Train", icon: { line: "target" } },
  { key: "progress", href: "/progress", label: "Progress", icon: { line: "chart" } },
  // Beside Progress: that page says which phase is slow, this one shows the
  // moment in a single solve where it happened.
  { key: "review", href: "/review", label: "Review", icon: { line: "review" } },
  // Last: connecting hardware is something you do once, not an activity.
  { key: "cube", href: "/cube", label: "Your cube", icon: { line: "cube" } },
];

/** The four places a phone user goes most, plus the way to everything else. */
const TABS: NavLink[] = [
  { key: "timer", href: "/timer", label: "Solve", icon: { face: "solve" } },
  { key: "ranked", href: "/ranked", label: "Ranked", icon: { face: "ranked" } },
  { key: "daily", href: "/daily", label: "Daily", icon: { face: "daily" } },
  { key: "progress", href: "/progress", label: "Progress", icon: { line: "chart" } },
];

export function SiteHeader({
  active,
  fade = false,
  trailing,
}: {
  active: NavKey;
  fade?: boolean;
  /** Extra text shown beside the brand, e.g. the daily's date. */
  trailing?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const chrome = fade ? "solving-hidden" : "solving-visible";

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      {/* Phone: brand, account and the menu button. In the flow, not fixed —
          a pinned bar would take 56px from a clock that needs every one. */}
      <header className={`flex items-center gap-3 px-4 py-3 lg:hidden ${chrome}`}>
        <Brand />
        {/* Not on a phone: there is no room beside the account and menu
            buttons, and the pages that pass it say the same thing larger. */}
        {trailing ? <span className="hidden truncate text-xs text-muted-dim sm:inline">{trailing}</span> : null}
        <span className="flex-1" />
        <AuthControl compact />
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-expanded={open}
          aria-controls="site-nav"
          className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-muted transition-colors hover:text-foreground"
        >
          Menu
        </button>
      </header>

      {/* The one nav. A sidebar from `lg`, a drawer below it. */}
      {open ? (
        <button
          type="button"
          aria-label="Close menu"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-[2px] lg:hidden"
        />
      ) : null}
      <nav
        id="site-nav"
        aria-label="Site"
        data-open={open}
        className={`shell-rail fixed inset-y-0 left-0 z-50 flex w-[248px] flex-col gap-1 overflow-y-auto border-r border-border bg-surface px-3 pb-4 pt-5 ${chrome}`}
      >
        <div className="flex items-center justify-between px-2 pb-4">
          <Brand onNavigate={() => setOpen(false)} />
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded-md px-2 py-1 text-xs text-muted-dim hover:text-foreground lg:hidden"
          >
            Close
          </button>
        </div>
        {trailing ? <p className="hidden px-3 pb-3 text-xs text-muted-dim lg:block">{trailing}</p> : null}

        <Link href="/timer" onClick={() => setOpen(false)} className="btn-go mx-1 mb-4 justify-center py-3 text-[15px]">
          Solve now
        </Link>

        <NavGroup label="Compete" links={COMPETE} active={active} onNavigate={() => setOpen(false)} />
        <NavGroup label="Practice" links={PRACTICE} active={active} onNavigate={() => setOpen(false)} />

        <div className="mt-auto flex flex-col gap-2 border-t border-border px-1 pt-4">
          <AuthControl />
          <div className="flex gap-4 px-2 text-[11px] text-muted-dim">
            <Link href="/privacy" className="hover:text-foreground">
              Privacy
            </Link>
            <a href="https://github.com/arhancanli/cubeduel" className="hover:text-foreground">
              Source
            </a>
          </div>
        </div>
      </nav>

      {/* Phone: the tab bar. Plain links, no groups — the grouped nav above is
          the full map, this is only the short way to the places people go. */}
      <nav
        aria-label="Shortcuts"
        className={`shell-tabs fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-border bg-surface/95 pb-[max(env(safe-area-inset-bottom),6px)] pt-1.5 backdrop-blur lg:hidden ${chrome}`}
      >
        {TABS.map((tab) => {
          const current = tab.key === active;
          return (
            <Link
              key={tab.key}
              href={tab.href}
              aria-current={current ? "page" : undefined}
              className={`flex flex-col items-center gap-1 py-1 text-[11px] font-semibold ${
                current ? "text-foreground" : "text-muted-dim"
              }`}
            >
              <NavIcon icon={tab.icon} size={20} lit={current} />
              {tab.label}
            </Link>
          );
        })}
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex flex-col items-center gap-1 py-1 text-[11px] font-semibold text-muted-dim"
        >
          <LineIcon name="more" size={20} />
          More
        </button>
      </nav>
    </>
  );
}

function Brand({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <Link href="/" onClick={onNavigate} className="flex shrink-0 items-center gap-2.5" aria-label="cubeduel home">
      <Mark size={22} />
      <span className="font-display text-[19px] font-extrabold tracking-tight">cubeduel</span>
    </Link>
  );
}

/**
 * The account corner.
 *
 * A placeholder holds the slot while the session resolves, so nothing jumps a
 * beat after the page paints. Signed in, this is a link to settings rather than a
 * menu: there are exactly two things an account holder does here — change their
 * handle and sign out — and both live on that page.
 */
function AuthControl({ compact = false }: { compact?: boolean }) {
  const { loaded, session } = useSession();

  // Not `!session.signedIn` — before the answer arrives the honest state is
  // "unknown", and rendering "Sign in" at somebody who is signed in is the
  // flash this placeholder exists to prevent.
  if (!loaded) return <span className={compact ? "inline-block w-14" : "block h-11"} aria-hidden="true" />;

  if (session.signedIn) {
    const name = session.handle ?? "Account";
    if (compact) {
      return (
        <Link
          href="/settings"
          className="max-w-28 truncate rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted transition-colors hover:text-foreground"
        >
          {name}
        </Link>
      );
    }
    return (
      <Link
        href="/settings"
        className="flex items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-surface-hi"
      >
        <span
          aria-hidden="true"
          className="grid size-8 shrink-0 place-items-center rounded-lg bg-surface-hi font-display text-sm font-bold uppercase"
        >
          {name.slice(0, 1)}
        </span>
        <span className="min-w-0 truncate text-sm font-semibold">{name}</span>
      </Link>
    );
  }

  if (compact) {
    return (
      <Link
        href="/sign-in"
        className="rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted transition-colors hover:text-foreground"
      >
        Sign in
      </Link>
    );
  }
  return (
    <Link href="/sign-in" className="btn-secondary justify-center py-2.5 text-sm">
      Sign in
    </Link>
  );
}

/**
 * One half of the nav. The label is always present for assistive tech, so a
 * screen reader announces "Compete" before the things you can compete at.
 */
function NavGroup({
  label,
  links,
  active,
  onNavigate,
}: {
  label: string;
  links: NavLink[];
  active: NavKey;
  onNavigate: () => void;
}) {
  return (
    <div className="flex flex-col gap-0.5 pb-3" role="group" aria-label={label}>
      <span className="px-3 pb-1.5 pt-1 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-dim">
        {label}
      </span>
      {links.map((link) =>
        link.key === active ? (
          <span
            key={link.key}
            aria-current="page"
            className="flex items-center gap-3 rounded-lg bg-surface-hi px-3 py-2 text-[15px] font-semibold text-foreground"
          >
            <NavIcon icon={link.icon} lit />
            {link.label}
          </span>
        ) : (
          <Link
            key={link.key}
            href={link.href}
            onClick={onNavigate}
            className="group flex items-center gap-3 rounded-lg px-3 py-2 text-[15px] font-medium text-muted transition-colors hover:bg-surface-hi/60 hover:text-foreground"
          >
            <NavIcon icon={link.icon} />
            {link.label}
          </Link>
        ),
      )}
    </div>
  );
}

function NavIcon({ icon, size = 18, lit = false }: { icon: Icon; size?: number; lit?: boolean }) {
  if ("face" in icon) {
    const face = faceFor(icon.face);
    return <Glyph pattern={face.glyph} sticker={face.sticker} size={size} />;
  }
  return <LineIcon name={icon.line} size={size} className={lit ? "text-foreground" : "text-muted-dim"} />;
}

type LineIconName = "podium" | "people" | "keys" | "book" | "cases" | "target" | "chart" | "cube" | "review" | "more";

const LINE_PATHS: Record<LineIconName, string> = {
  podium: "M4 20V13h5v7M9 20V8h6v12M15 20v-9h5v9M3 20h18",
  people: "M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M16 5.5a3 3 0 0 1 0 5.8M18 14.5c1.8.8 3 2.8 3 5.5",
  keys: "M3 7h18v11H3zM7 11h.01M11 11h.01M15 11h.01M8 15h8",
  book: "M4 5.5C4 4.7 4.7 4 5.5 4H11v16H5.5c-.8 0-1.5-.7-1.5-1.5v-13ZM20 5.5c0-.8-.7-1.5-1.5-1.5H13v16h5.5c.8 0 1.5-.7 1.5-1.5v-13Z",
  cases: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  target: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM12 12h.01",
  chart: "M4 20V4M4 20h16M8 16l4-5 3 3 5-7",
  cube: "M12 3 20 7.5v9L12 21l-8-4.5v-9L12 3ZM4 7.5 12 12l8-4.5M12 12v9",
  review: "M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13ZM15.2 15.2 20 20M8 10.5h5M10.5 8v5",
  more: "M4 7h16M4 12h16M4 17h16",
};

function LineIcon({ name, size = 18, className = "" }: { name: LineIconName; size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={`shrink-0 ${className}`}
    >
      <path d={LINE_PATHS[name]} />
    </svg>
  );
}
