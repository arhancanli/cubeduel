/**
 * Which pages are worth landing on cold, and why the rest are not.
 *
 * This exists as data rather than as a list inside `sitemap.ts` because the
 * sitemap kept drifting. Eighty-two pages were added over three sessions —
 * `/solve`, `/learn`, all 78 case pages, `/cube`, `/clubs` — and every one of
 * them was invisible to search, because adding a route and adding a sitemap
 * entry were two separate acts and nothing connected them.
 *
 * `npm run audit` now walks the app directory and refuses any page route that is
 * neither listed here nor excluded below with a reason. A page can still be left
 * out; it just cannot be left out silently.
 */

export interface IndexableRoute {
  path: string;
  changeFrequency: "hourly" | "daily" | "weekly" | "monthly" | "yearly";
  priority: number;
}

export const INDEXABLE: IndexableRoute[] = [
  { path: "/", changeFrequency: "weekly", priority: 1 },

  // The two pages somebody might arrive at without knowing this site exists.
  // "How to solve a Rubik's cube" is the question; /solve is the answer, and it
  // is the only page here that is useful to a person who cannot cube at all.
  { path: "/solve", changeFrequency: "monthly", priority: 0.95 },
  { path: "/learn", changeFrequency: "monthly", priority: 0.9 },

  { path: "/play", changeFrequency: "monthly", priority: 0.9 },
  { path: "/daily", changeFrequency: "daily", priority: 0.9 },
  { path: "/ranked", changeFrequency: "monthly", priority: 0.8 },
  { path: "/duel", changeFrequency: "monthly", priority: 0.8 },
  { path: "/rush", changeFrequency: "monthly", priority: 0.8 },
  { path: "/race", changeFrequency: "monthly", priority: 0.8 },
  { path: "/train", changeFrequency: "monthly", priority: 0.7 },
  { path: "/timer", changeFrequency: "monthly", priority: 0.7 },
  { path: "/cube", changeFrequency: "monthly", priority: 0.7 },
  { path: "/clubs", changeFrequency: "monthly", priority: 0.6 },
  { path: "/leaderboard", changeFrequency: "hourly", priority: 0.6 },
  { path: "/progress", changeFrequency: "monthly", priority: 0.5 },
  { path: "/privacy", changeFrequency: "yearly", priority: 0.3 },
];

/**
 * Pages deliberately left out, each with the reason.
 *
 * A reason is required. "Not in the sitemap" with no explanation is
 * indistinguishable from "nobody remembered", which is exactly the failure this
 * file was written to stop.
 */
export const EXCLUDED: Record<string, string> = {
  "/settings": "Useless without an account, and personal to whoever is signed in.",
  "/sign-in": "A door, not a destination. Nothing to read here.",
  "/join": "Same. It is reached from a page that explains why you would.",

  // These carry a single-use token in the URL. A crawler that fetched one would
  // SPEND it and then publish the page it landed on, so they also set
  // `robots: { index: false }` on the page itself — a sitemap omission only
  // means a crawler was not invited, not that it will stay away.
  "/verify": "Carries a single-use token that fetching would spend.",
  "/reset": "Carries a single-use token that fetching would spend.",
  "/forgot": "Leads to an emailed token; nothing here is worth indexing.",

  // Made by people, not by us. Listing them would publish a directory of users
  // and their solves that nobody asked to be in.
  "/u/[handle]": "A person's page. Ours to serve, not ours to advertise.",
  "/s/[id]": "Somebody's solve. Shared by them, when they choose to.",
  "/review": "Reads solves kept in this browser; to a crawler it is an empty page.",
  "/c/[slug]": "A club's board. Private to the people who were given the code.",
  "/challenge/[id]": "A one-off link between two players.",
  "/race/[code]": "A one-off race between two players, over in minutes.",
};

/** The one dynamic route that IS enumerated, because the set is fixed and ours. */
export const ENUMERATED_DYNAMIC = ["/learn/[slug]"];
