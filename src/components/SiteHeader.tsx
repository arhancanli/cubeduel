"use client";

import { useSession } from "@/lib/useSession";
import Link from "next/link";

/**
 * One header for every screen.
 *
 * `fade` exists because the timer and the daily blank their chrome the instant a
 * solve starts — nothing but the clock should be on screen while someone is
 * solving, and that includes the nav and the account button.
 */
export type NavKey =
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
  | "progress";

interface NavLink {
  key: NavKey;
  href: string;
  label: string;
}

/**
 * Two groups, because they are two different activities.
 *
 * **Compete** puts something on the record: a rating moves, a result is
 * published, an opponent is waiting. **Practice** does not — nothing there is
 * recorded against you, and that is the point of it.
 *
 * A flat list of eight said nothing about which was which, so the two audiences
 * this platform serves — somebody grinding toward a national final, and somebody
 * who wants to get from a minute to thirty seconds — had to work out for
 * themselves which half of the nav was theirs. Separating them is not decoration:
 * it is the difference between "everything here is being judged" and "this bit
 * is yours to fail in".
 */
const COMPETE: NavLink[] = [
  { key: "ranked", href: "/ranked", label: "Ranked" },
  { key: "rush", href: "/rush", label: "Rush" },
  { key: "duel", href: "/duel", label: "Duel" },
  { key: "daily", href: "/daily", label: "Daily" },
  { key: "leaderboard", href: "/leaderboard", label: "Leaderboard" },
  // Under Compete rather than Practice, because a club board ranks you against
  // people by the same verified solves the global one uses. It is the same
  // ladder seen from closer up, not a separate, gentler one.
  { key: "clubs", href: "/clubs", label: "Clubs" },
];

const PRACTICE: NavLink[] = [
  { key: "play", href: "/play", label: "Play" },
  { key: "timer", href: "/timer", label: "Timer" },
  // Before Train, because it is the earlier half of the same activity: Learn is
  // where you meet a case, Train is where you keep it.
  // First in Practice, because it is the only entry that assumes nothing. Every
  // other page here takes it for granted that you can already solve a cube.
  { key: "solve", href: "/solve", label: "How to solve" },
  { key: "learn", href: "/learn", label: "Learn" },
  { key: "train", href: "/train", label: "Train" },
  { key: "progress", href: "/progress", label: "Progress" },
  // Last, because it is the only entry here that is not an activity. Connecting
  // hardware is something you do once and then forget about, and putting it
  // between Learn and Train would interrupt the one sequence this group
  // describes: meet a case, then keep it.
  { key: "cube", href: "/cube", label: "Your cube" },
];

export function SiteHeader({
  active,
  fade = false,
  trailing,
}: {
  active: NavKey;
  fade?: boolean;
  /** Extra text shown before the nav, e.g. the daily's date. */
  trailing?: React.ReactNode;
}) {
  return (
    <header
      className={`flex items-center gap-3 px-4 py-4 sm:px-6 ${
        fade ? "solving-hidden" : "solving-visible"
      }`}
    >
      <Link href="/" className="shrink-0 text-sm font-semibold tracking-tight">
        cubeduel
      </Link>

      {/*
        Six destinations do not fit beside a wordmark and an account control on a
        390px screen, and the previous four already wrapped the header to 96px.
        The nav scrolls sideways instead of collapsing into a menu: a menu hides
        where you can go behind a tap, and on a site whose whole proposition is
        "start solving immediately" that is the wrong trade. The scrollbar is
        hidden because the fade at the edge already says there is more.
      */}
      <nav className="flex min-w-0 flex-1 items-center gap-4 overflow-x-auto text-xs [-ms-overflow-style:none] [scrollbar-width:none] sm:gap-5 [&::-webkit-scrollbar]:hidden">
        {trailing ? (
          <span className="hidden shrink-0 text-muted-dim sm:inline">{trailing}</span>
        ) : null}
        <NavGroup label="Compete" links={COMPETE} active={active} />

        {/* A rule rather than a gap: on a horizontally scrolling nav a gap wide
            enough to read as a separator is a gap wide enough to push a
            destination off screen. */}
        <span aria-hidden="true" className="h-3 w-px shrink-0 bg-border" />

        <NavGroup label="Practice" links={PRACTICE} active={active} />
      </nav>

      <div className="shrink-0">
        <AuthControl />
      </div>
    </header>
  );
}

/**
 * The account corner.
 *
 * A fixed-width placeholder holds the slot while the session resolves, so the
 * nav does not jump sideways a beat after the page paints. That mattered under
 * Clerk and it matters now for the same reason — the answer arrives over the
 * network, and layout that settles late reads as a page still loading.
 *
 * Signed in, this is a link to settings rather than a menu. There are exactly
 * two things an account holder does here — change their handle and sign out —
 * and both live on the settings page. A dropdown holding two items is
 * ceremony.
 */
function AuthControl() {
  const { loaded, session } = useSession();

  // Not `!session.signedIn` — before the answer arrives the honest state is
  // "unknown", and rendering "Sign in" at somebody who is signed in is the
  // flash this placeholder exists to prevent.
  if (!loaded) return <span className="inline-block w-14" aria-hidden="true" />;

  if (session.signedIn) {
    return (
      <Link
        href="/settings"
        className="rounded-md border border-border px-2.5 py-1 text-xs text-muted transition-colors hover:border-muted-dim hover:text-foreground"
      >
        {session.handle ?? "Account"}
      </Link>
    );
  }

  return (
    <Link
      href="/sign-in"
      className="rounded-md border border-border px-2.5 py-1 text-xs text-muted transition-colors hover:border-muted-dim hover:text-foreground"
    >
      Sign in
    </Link>
  );
}

/**
 * One half of the nav.
 *
 * The label is visible from `sm` up and always present for assistive tech, so a
 * screen reader announces "Compete" before the four things you can compete at,
 * rather than eight destinations in a row with no structure.
 */
function NavGroup({
  label,
  links,
  active,
}: {
  label: string;
  links: NavLink[];
  active: NavKey;
}) {
  return (
    <div className="flex shrink-0 items-center gap-4 sm:gap-5" role="group" aria-label={label}>
      <span className="hidden shrink-0 text-[10px] uppercase tracking-widest text-muted-dim md:inline">
        {label}
      </span>
      {links.map((link) =>
        link.key === active ? (
          <span key={link.key} className="shrink-0 text-foreground" aria-current="page">
            {link.label}
          </span>
        ) : (
          <Link
            key={link.key}
            href={link.href}
            className="shrink-0 text-muted transition-colors hover:text-foreground"
          >
            {link.label}
          </Link>
        ),
      )}
    </div>
  );
}
