import { decideWinner, hasSolved, type Side } from "./challenge";

/**
 * A live race: two people, one scramble, the same moment.
 *
 * Chess.com's core is two people playing at once. Cubing had nothing like it —
 * the head-to-head challenges here are deliberately asynchronous, because a live
 * lobby needs two people online in the same second, and a site with no players
 * would leave everybody waiting for nobody. A race answers that differently: it
 * is made for two people who have already arranged it. One creates it and sends
 * the link; the other opens it; both press ready; a countdown both screens share
 * ends with the same scramble appearing for both. It needs a friend, not a crowd.
 *
 * Everything that decides the result is the server's, exactly as in a
 * challenge: the scramble is generated when both are ready and withheld until
 * the moment the race starts, every solve is replayed against it, and
 * inspection is timed from the moment it became visible. What each player sees
 * of the other while solving — how far through the solve they are — is shown,
 * never trusted: it decides nothing.
 */

/** From both pressing ready to the scramble appearing. Long enough to settle hands. */
export const RACE_COUNTDOWN_MS = 5_000;

/** How long a race waits for its second player and for both to press ready. */
export const RACE_LOBBY_TTL_MS = 30 * 60 * 1000;

/**
 * How long after the start a seat may still finish. Past this, a seat with no
 * result is a DNF, judged on read like everything else here — there is no cron.
 * Generous, because a slow 5x5 is minutes; walking away should not stall the
 * other player's result for longer than this.
 */
export const RACE_SOLVE_WINDOW_MS = 10 * 60 * 1000;

/**
 * The stages a live progress bar counts: the cross, four F2L pairs, the last
 * layer oriented, and solved. See `liveStage` in cfop.ts.
 */
export const RACE_STAGES = 7;

export type RaceSeat = "host" | "guest";
export type RaceStatus = "lobby" | "started" | "finished" | "abandoned";
export type RacePhase = "lobby" | "countdown" | "racing" | "finished" | "abandoned";
export type RaceWinner = RaceSeat | "draw";

export interface RaceState {
  status: RaceStatus;
  guestPresent: boolean;
  hostReady: boolean;
  guestReady: boolean;
  /** When the scramble appears. Null until both are ready. */
  startAt: number | null;
  /** When an unstarted race lapses. */
  expiresAt: number;
  host: Side;
  guest: Side;
}

/** Where a race stands at `now`, as the screens need to know it. */
export function phaseOf(state: RaceState, now: number): RacePhase {
  if (state.status === "finished") return "finished";
  if (state.status === "abandoned") return "abandoned";
  if (state.status === "lobby") return now > state.expiresAt ? "abandoned" : "lobby";
  // Started: counting down until the scramble appears, then racing.
  if (state.startAt !== null && now < state.startAt) return "countdown";
  return "racing";
}

/** Whether both seats are filled and ready — the moment to start the countdown. */
export function readyToStart(state: RaceState): boolean {
  return state.status === "lobby" && state.guestPresent && state.hostReady && state.guestReady;
}

/**
 * The scramble may be sent only once it is showing on both screens. Sending it
 * during the countdown would let whoever read the network response first study
 * it for five seconds the other player does not get.
 */
export function scrambleVisible(state: RaceState, now: number): boolean {
  const phase = phaseOf(state, now);
  return phase === "racing" || phase === "finished";
}

const DNF: Side = { durationMs: 0, penalty: "DNF" };

export type RaceResolution =
  | { settled: false }
  | { settled: true; status: "finished"; winner: RaceWinner; host: Side; guest: Side; reason: string }
  | { settled: true; status: "abandoned"; reason: string };

/**
 * What a race should become, given where it stands right now. Judged on read,
 * as challenges are, so the answer is right the moment anybody looks.
 */
export function resolveRace(state: RaceState, now: number): RaceResolution {
  if (state.status === "lobby") {
    return now > state.expiresAt
      ? { settled: true, status: "abandoned", reason: "never started" }
      : { settled: false };
  }
  if (state.status !== "started" || state.startAt === null) return { settled: false };

  const hostIn = hasSolved(state.host);
  const guestIn = hasSolved(state.guest);
  if (hostIn && guestIn) {
    return {
      settled: true,
      status: "finished",
      winner: toSeat(decideWinner(state.host, state.guest)),
      host: state.host,
      guest: state.guest,
      reason: "both finished",
    };
  }

  // Strictly past the window, the convention everywhere here: reaching a limit
  // is free and only exceeding it costs anything.
  if (now <= state.startAt + RACE_SOLVE_WINDOW_MS) return { settled: false };

  // Walking away is a DNF, not a way to deny the other player a result.
  const host = hostIn ? state.host : DNF;
  const guest = guestIn ? state.guest : DNF;
  return {
    settled: true,
    status: "finished",
    winner: toSeat(decideWinner(host, guest)),
    host,
    guest,
    reason: "time ran out",
  };
}

function toSeat(winner: ReturnType<typeof decideWinner>): RaceWinner {
  return winner === "challenger" ? "host" : winner === "opponent" ? "guest" : "draw";
}

/** How far through the solve somebody is, as they report it. Display only. */
export interface RaceProgress {
  /** 0 to RACE_STAGES — see `liveStage`. */
  stage: number;
  /** Turns made so far. */
  turns: number;
}

/**
 * A progress report reduced to what it can honestly be: a stage in range and a
 * turn count. It is the one number here the server does not check against
 * anything, so it is bounded rather than believed — and it decides nothing.
 */
export function sanitizeProgress(value: unknown): RaceProgress | null {
  if (typeof value !== "object" || value === null) return null;
  const { stage, turns } = value as Record<string, unknown>;
  if (typeof stage !== "number" || !Number.isInteger(stage) || stage < 0 || stage > RACE_STAGES) {
    return null;
  }
  if (typeof turns !== "number" || !Number.isInteger(turns) || turns < 0 || turns > 2000) return null;
  return { stage, turns };
}

/** A short code for the race's address, from the join-code alphabet. */
export function raceCode(random: () => number = Math.random): string {
  // No i, l, o, 0 or 1: a code read aloud or copied by hand survives it.
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  let out = "";
  for (let i = 0; i < 8; i++) out += alphabet[Math.floor(random() * alphabet.length)];
  return out;
}

export function isRaceCode(value: unknown): value is string {
  return typeof value === "string" && /^[a-hjkmnp-z2-9]{8}$/.test(value);
}
