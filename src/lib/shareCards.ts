import { EVENTS, isEventId } from "./events";
import { formatMs } from "./format";

/**
 * What each share card says.
 *
 * Separated from the drawing so it can be tested: the rendering is Satori and a
 * PNG, but the decisions — whose name goes first, whether a race that nobody
 * joined says so, what a card may admit about an unrated player — are ordinary
 * logic and every one of them is a claim about somebody.
 *
 * Three rules run through all of it:
 *
 *   - **Never the scramble.** A race and a challenge are one cube shared between
 *     two people; a preview showing it would let whoever opened the link study
 *     the solve in the group chat before anybody pressed ready. The daily's card
 *     has always worked this way.
 *   - **Never a number the app would not print.** An unestablished rating is
 *     written as unrated, not as a figure with the uncertainty quietly dropped —
 *     a card is where a number is most likely to be screenshotted and least
 *     likely to carry its ±.
 *   - **Nothing the sender has not already shared** by sending the link.
 */

export interface CardContent {
  /** The small word at the top: what kind of link this is. */
  kind: string;
  headline: string;
  subheading: string | null;
  figures: { value: string; label: string }[];
  /** Shown instead of figures when there are none. */
  footnote: string | null;
}

/**
 * Names are as long as people make them, and a card is 1200 pixels wide.
 *
 * Found by looking at one: a twenty-four character name pushed the headline to
 * three lines and the rest of the card off the bottom. Trimmed at a length that
 * fits two names and the word between them on one line.
 */
function clampName(name: string, max = 20): string {
  const trimmed = name.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1).trimEnd()}…`;
}

function eventName(event: string): string {
  return isEventId(event) ? EVENTS[event].name : event;
}

function resultText(result: { durationMs: number; penalty: string } | null): string {
  if (!result) return "—";
  if (result.penalty === "DNF") return "DNF";
  const ms = result.penalty === "PLUS2" ? result.durationMs + 2000 : result.durationMs;
  return formatMs(ms);
}

export interface RaceCardInput {
  event: string;
  status: "lobby" | "started" | "finished" | "abandoned";
  hostName: string;
  guestName: string | null;
  winner: "host" | "guest" | "draw" | null;
  hostResult: { durationMs: number; penalty: string } | null;
  guestResult: { durationMs: number; penalty: string } | null;
}

/**
 * A race link, which is the one card that is an invitation rather than a report.
 *
 * Before anybody has taken the seat it asks; once both are in it names them;
 * once it is over it says who won and by how much. The rules go on the card
 * before the race rather than after, because whoever opens the link is about to
 * press ready and the surprising one — that the faster solve wins, not the first
 * to finish — is worth knowing first.
 */
export function raceCardContent(race: RaceCardInput | null): CardContent {
  const kind = "cubeduel · race";
  if (!race) {
    return {
      kind,
      headline: "This race has gone",
      subheading: "Race links last half an hour. Start another one — it takes a click.",
      figures: [],
      footnote: null,
    };
  }

  const event = eventName(race.event);
  const hostName = clampName(race.hostName);
  const guestName = race.guestName ? clampName(race.guestName) : null;

  if (race.status === "abandoned") {
    return {
      kind,
      headline: "A race that never happened",
      subheading: "Nobody took the second seat before it expired.",
      figures: [],
      footnote: `${event} · started by ${hostName}`,
    };
  }

  if (race.status === "finished") {
    const winner =
      race.winner === "host"
        ? hostName
        : race.winner === "guest"
          ? (guestName ?? "The guest")
          : null;
    return {
      kind,
      headline: winner ? `${winner} won` : "A dead heat",
      subheading: `${hostName} against ${guestName ?? "a guest"} on one ${event} scramble.`,
      figures: [
        { value: resultText(race.hostResult), label: hostName },
        { value: resultText(race.guestResult), label: guestName ?? "guest" },
      ],
      footnote: null,
    };
  }

  if (!guestName) {
    return {
      kind,
      headline: `${hostName} wants to race`,
      subheading: "One scramble, both screens, at the same moment. The faster solve wins — inspection is your own.",
      figures: [],
      footnote: `${event} · open the link to take the seat`,
    };
  }

  return {
    kind,
    headline: `${hostName} v ${guestName}`,
    subheading: "One scramble, both screens, at the same moment.",
    figures: [],
    footnote: `${event} · in progress`,
  };
}

export interface SolveCardInput {
  event: string;
  durationMs: number;
  penalty: string;
  displayName: string;
  handle: string;
  moveCount: number;
  tps: number;
  verified: boolean;
  mode: string;
}

const MODE_WORDS: Record<string, string> = {
  practice: "practice",
  daily: "the daily",
  duel: "a duel",
  ranked: "a ranked solve",
  challenge: "a challenge",
  rush: "a rush run",
  race: "a race",
};

/**
 * A solve permalink: one time, and the things that make it more than a number.
 *
 * "Verified" is on the card because it is the claim this site exists to make —
 * the moves were replayed on a model of the cube and they solve it. A solve
 * without that says so plainly rather than leaving the word off and hoping
 * nobody notices its absence.
 */
export function solveCardContent(solve: SolveCardInput | null): CardContent {
  const kind = "cubeduel · solve";
  if (!solve) {
    return {
      kind,
      headline: "No such solve",
      subheading: "This link has expired or never existed.",
      figures: [],
      footnote: null,
    };
  }

  const time = resultText({ durationMs: solve.durationMs, penalty: solve.penalty });
  const where = MODE_WORDS[solve.mode] ?? solve.mode;

  // A display name that is just the handle reads as a stutter — "arhan
  // (@arhan)" — so the handle alone does the naming.
  const named =
    solve.displayName.trim().toLowerCase() === solve.handle.trim().toLowerCase()
      ? `@${solve.handle}`
      : `${clampName(solve.displayName)} (@${solve.handle})`;

  return {
    kind,
    headline: solve.penalty === "DNF" ? "DNF" : time,
    subheading: `${named} on ${eventName(solve.event)}, in ${where}.`,
    figures: [
      { value: String(solve.moveCount), label: "moves" },
      { value: solve.tps.toFixed(1), label: "turns per second" },
      solve.verified
        ? { value: "verified", label: "replayed move by move" }
        : { value: "unverified", label: "no move stream stored" },
    ],
    footnote: null,
  };
}

export interface ProfileCardInput {
  displayName: string;
  handle: string;
  event: string;
  rating: number | null;
  deviation: number;
  established: boolean;
  rank: number | null;
  rankedSolves: number;
  bestSingleMs: number | null;
}

/**
 * A player's page.
 *
 * The rating is the awkward part, and the app's rule applies here too: a rating
 * that has not settled is not a ranking, and printing it as one is the single
 * easiest way for this site to say something untrue. So an unestablished player
 * gets the honest word instead, and an established one carries the ± that the
 * rest of the app shows.
 */
export function profileCardContent(profile: ProfileCardInput | null): CardContent {
  const kind = "cubeduel · player";
  if (!profile) {
    return {
      kind,
      headline: "No such player",
      subheading: "That handle does not belong to anybody here.",
      figures: [],
      footnote: null,
    };
  }

  const figures: { value: string; label: string }[] = [
    {
      value:
        profile.established && profile.rating !== null
          ? `${profile.rating} ±${Math.round(profile.deviation)}`
          : "unrated",
      label:
        profile.established && profile.rank !== null
          ? `${eventName(profile.event)} rating · rank ${profile.rank}`
          : `${eventName(profile.event)} rating`,
    },
    {
      value: profile.bestSingleMs === null ? "—" : formatMs(profile.bestSingleMs),
      label: "best verified single",
    },
    { value: String(profile.rankedSolves), label: "ranked solves" },
  ];

  return {
    kind,
    headline: clampName(profile.displayName, 26),
    subheading: profile.displayName.trim().toLowerCase() === profile.handle.trim().toLowerCase()
      ? null
      : `@${profile.handle}`,
    figures,
    footnote: null,
  };
}
