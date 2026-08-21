import { DEFAULT_EVENT, EVENTS, type EventId } from "./events";
import { type RatingPool, ratingForMs } from "./rating";

/**
 * The World Cube Association: official results, beside the ones earned here.
 *
 * This is the question only a site with a real rating can ask — *how does what
 * I do online compare to what I did at a competition?* — and it is the reason
 * to build it. It is also the easiest place in this product to say something
 * false, so most of this file is about not doing that.
 *
 * ## The comparison that is honest, and the one that is not
 *
 * A WCA average is five solves on a real cube, in a hall, judged, under
 * pressure. A cubeduel keyboard rating is five solves typed on a keyboard.
 * **These are different skills**, and the gap between them is mostly about the
 * input device rather than about the cuber.
 *
 * So the two are never subtracted from each other and presented as an
 * improvement or a decline. The smart-cube pool is the one that is close to
 * comparable — real cube, real hands — and even there a living room is not a
 * competition. What this offers instead is both numbers, side by side, each
 * labelled with what it actually measured.
 *
 * That restraint is the feature. A site willing to tell somebody their WCA
 * average proves they are getting worse online would be a site whose numbers
 * nobody should trust.
 */

/**
 * A WCA id: four digits of year, four letters from the surname, two digits.
 *
 * Validated rather than merely trimmed because it goes straight into a URL on
 * `worldcubeassociation.org`, and a malformed one is the difference between a
 * 404 and a request we should never have made.
 */
const WCA_ID = /^\d{4}[A-Z]{4}\d{2}$/;

export function isValidWcaId(id: string): boolean {
  return WCA_ID.test(id.trim().toUpperCase());
}

export function normaliseWcaId(id: string): string | null {
  const cleaned = id.trim().toUpperCase().replace(/\s+/g, "");
  return WCA_ID.test(cleaned) ? cleaned : null;
}

/** WCA results are centiseconds. Everything in this app is milliseconds. */
export function centisecondsToMs(centiseconds: number): number {
  return centiseconds * 10;
}

/**
 * The events cubeduel rates, and their WCA identifiers.
 *
 * They happen to be the same strings, because both follow the WCA's own
 * naming — but the mapping is written out rather than assumed, so that adding
 * an event here that the WCA calls something else does not silently produce a
 * lookup for a record that does not exist.
 */
export const WCA_EVENT_IDS: Record<EventId, string> = {
  "222": "222",
  "333": "333",
  "444": "444",
  "555": "555",
};

export interface WcaRecord {
  /** Milliseconds. Null when they have no ranked result for this event. */
  singleMs: number | null;
  averageMs: number | null;
  worldRank: number | null;
  countryRank: number | null;
}

export interface WcaProfile {
  wcaId: string;
  name: string;
  country: string | null;
  competitionCount: number;
  records: Partial<Record<EventId, WcaRecord>>;
}

/** Shapes the WCA's response, tolerating everything it might omit. */
export function parseWcaPerson(payload: unknown): WcaProfile | null {
  if (typeof payload !== "object" || payload === null) return null;
  const body = payload as Record<string, unknown>;

  const person = body.person as Record<string, unknown> | undefined;
  if (!person) return null;

  const wcaId = typeof person.wca_id === "string" ? person.wca_id : null;
  if (!wcaId || !isValidWcaId(wcaId)) return null;

  const rawRecords = (body.personal_records ?? {}) as Record<string, unknown>;
  const records: Partial<Record<EventId, WcaRecord>> = {};

  for (const [eventId, wcaEvent] of Object.entries(WCA_EVENT_IDS) as [EventId, string][]) {
    const entry = rawRecords[wcaEvent] as Record<string, unknown> | undefined;
    if (!entry) continue;

    const single = entry.single as Record<string, unknown> | undefined;
    const average = entry.average as Record<string, unknown> | undefined;

    // A cuber can have a single and no average — a competition where they never
    // completed five solves. Recording that as a zero, or skipping the event
    // entirely, would both be wrong: they have one result and not the other.
    records[eventId] = {
      singleMs: typeof single?.best === "number" ? centisecondsToMs(single.best) : null,
      averageMs: typeof average?.best === "number" ? centisecondsToMs(average.best) : null,
      worldRank: typeof average?.world_rank === "number" ? average.world_rank : null,
      countryRank: typeof average?.country_rank === "number" ? average.country_rank : null,
    };
  }

  const country = person.country as Record<string, unknown> | undefined;

  return {
    wcaId,
    name: typeof person.name === "string" ? person.name : wcaId,
    country: typeof country?.name === "string" ? country.name : null,
    competitionCount:
      typeof body.competition_count === "number" ? body.competition_count : 0,
    records,
  };
}

/**
 * What a WCA average would be worth on this ladder.
 *
 * The rating scale is a pure function of time, so an official average converts
 * exactly the same way any other average does. This is the number that makes
 * the comparison mean anything: "your competition average is 12.4s, which is
 * 1930 on this scale."
 *
 * It is a conversion, never a rating. Nothing here writes to `ratings`, appears
 * on a leaderboard, or counts toward anything — a rating on this ladder is
 * earned by solves this server issued a scramble for and replayed, and a result
 * from somebody else's competition is not that however true it is.
 */
export function ratingForWcaAverage(
  averageMs: number,
  event: EventId = DEFAULT_EVENT,
): number {
  return Math.round(ratingForMs(averageMs, event));
}

export type ComparisonKind =
  /** Smart cube against competition: close to like for like. */
  | "comparable"
  /** Keyboard against competition: different skills, shown side by side only. */
  | "different-skills"
  /** One of the two numbers does not exist yet. */
  | "incomplete";

export interface Comparison {
  kind: ComparisonKind;
  /** What this ladder says, in milliseconds. Null when unrated. */
  cubeduelMs: number | null;
  /** What the WCA says. Null when they have no average for this event. */
  wcaMs: number | null;
  /** The official average expressed on this ladder's scale. */
  wcaAsRating: number | null;
  /** One sentence, honest about what the two numbers are. */
  note: string;
}

/**
 * Puts the two numbers beside each other, and says what that is worth.
 *
 * Deliberately returns prose rather than a delta. The temptation is to show
 * "+1.2s" and let somebody read it as progress or decline; the truth is that a
 * keyboard average and a competition average differ mostly because one is typed
 * and the other is turned, and a signed number implies a comparison that the
 * two measurements do not support.
 */
export function compare(input: {
  event: EventId;
  pool: RatingPool;
  cubeduelMs: number | null;
  record: WcaRecord | undefined;
}): Comparison {
  const wcaMs = input.record?.averageMs ?? null;
  const wcaAsRating = wcaMs === null ? null : ratingForWcaAverage(wcaMs, input.event);
  const name = EVENTS[input.event].name;

  if (input.cubeduelMs === null || wcaMs === null) {
    return {
      kind: "incomplete",
      cubeduelMs: input.cubeduelMs,
      wcaMs,
      wcaAsRating,
      note:
        wcaMs === null
          ? `No official ${name} average yet — those come from a competition.`
          : `No established ${name} rating here yet. About 20 verified solves and there will be.`,
    };
  }

  if (input.pool === "smartcube") {
    return {
      kind: "comparable",
      cubeduelMs: input.cubeduelMs,
      wcaMs,
      wcaAsRating,
      note:
        "Both of these are a real cube in your hands, so they are close to like " +
        "for like — though a living room is not a competition hall.",
    };
  }

  return {
    kind: "different-skills",
    cubeduelMs: input.cubeduelMs,
    wcaMs,
    wcaAsRating,
    note:
      "These measure different things: one is typed, the other is turned. The " +
      "gap between them is mostly the input device rather than you, so it is " +
      "worth seeing but not worth subtracting.",
  };
}
