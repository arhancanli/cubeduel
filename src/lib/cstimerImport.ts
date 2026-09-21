import type { StoredSolve } from "./solveHistory";
import type { Penalty } from "./types";

/**
 * Bringing a csTimer history across.
 *
 * csTimer is where nearly every cuber's history already lives — free, instant,
 * a decade old — and that history is the single biggest reason not to try
 * anything else: switching means starting from zero solves, and every chart,
 * goal and trend here starts out saying "not enough solves yet". This reads the
 * file csTimer's own Export button writes, entirely in the browser, and turns it
 * into history here. Nothing is uploaded to be read.
 *
 * The format is csTimer's, read from its source (cs0x7f/cstimer,
 * src/js/export.js and src/js/stats/stats.js) rather than guessed:
 *
 *   { "session1": [solve, …], "session2": …, "properties": { "sessionData": … } }
 *   solve = [[penalty, ms, …], scramble, comment, unixSeconds, extra?]
 *   penalty: 0 = OK, 2000 = +2, -1 = DNF
 *
 * What an imported solve is, and is not:
 *
 * - **A time, from a real cube, with nobody watching.** Stored as `manual` —
 *   the same thing a stopwatch solve here is. It counts toward totals, bests,
 *   goals and trends, exactly like a stopwatch solve.
 * - **Never a rating.** Nothing here was scrambled by this server or replayed,
 *   and a real cube and a keyboard are different sports besides. It can no more
 *   reach the ladder than a time typed in could.
 * - **Only 3x3.** History here is 3x3; a 2x2 session merged in would put 2
 *   seconds beside 12 and call it one average. Other events are counted and
 *   named in the preview, not silently dropped.
 */

/** csTimer scramble types that are an ordinary 3x3 solve. */
const THREE_BY_THREE = new Set(["333", "333o"]);

/** A session with no scramble type set is csTimer's default, which is 3x3. */
const DEFAULT_SCRAMBLE_TYPE = "333";

/** Earlier than this is a clock that was never set, not a solve. */
const EARLIEST = Date.UTC(2010, 0, 1);

export interface ImportedSession {
  /** csTimer's session number. */
  index: number;
  name: string;
  scrambleType: string;
  /** Records in the file for this session. */
  records: number;
  /** Solves this session contributes. Zero for a session that is not 3x3. */
  usable: number;
  /** Why a whole session was left out, when it was. */
  skippedBecause: string | null;
}

export type ImportedSolve = StoredSolve & { origin: "cstimer" };

export type CsTimerParse =
  | {
      ok: true;
      sessions: ImportedSession[];
      solves: ImportedSolve[];
      /** Records inside 3x3 sessions that could not be read as a solve. */
      unreadable: number;
    }
  | { ok: false; error: string };

function asArray(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value;
  // Older exports stored each session as a JSON string rather than an array.
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
}

/** `properties.sessionData` is itself a JSON string in some versions, an object in others. */
function sessionMeta(properties: unknown): Record<string, { name?: unknown; opt?: { scrType?: unknown }; scr?: unknown }> {
  if (typeof properties !== "object" || properties === null) return {};
  let data: unknown = (properties as Record<string, unknown>).sessionData;
  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch {
      return {};
    }
  }
  return typeof data === "object" && data !== null ? (data as never) : {};
}

const PENALTY: Record<number, Penalty> = { 0: "OK", 2000: "PLUS2", [-1]: "DNF" };

function readSolve(record: unknown): ImportedSolve | null {
  if (!Array.isArray(record) || record.length < 4) return null;
  const [result, scramble, , seconds] = record;
  if (!Array.isArray(result) || result.length < 2) return null;
  const [penaltyCode, ms] = result;

  const penalty = typeof penaltyCode === "number" ? PENALTY[penaltyCode] : undefined;
  if (!penalty) return null;
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms <= 0 || ms > 86_400_000) return null;
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) return null;
  const at = Math.round(seconds * 1000);
  if (at < EARLIEST || at > Date.now() + 86_400_000) return null;

  const text = typeof scramble === "string" && scramble.length <= 512 ? scramble : "";
  return {
    // Deterministic, so importing the same file twice — or a newer export that
    // contains the older one — adds each solve once.
    id: `cst_${Math.round(seconds).toString(36)}_${Math.round(ms).toString(36)}`,
    at,
    scramble: text,
    durationMs: Math.round(ms),
    penalty,
    moveCount: 0,
    tps: 0,
    splits: [],
    ollCase: null,
    pllCase: null,
    ollSetup: null,
    pllSetup: null,
    source: "manual",
    origin: "cstimer",
  };
}

export function parseCsTimerExport(text: string): CsTimerParse {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: "That file is not a csTimer export — it is not JSON at all." };
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return { ok: false, error: "That file is not a csTimer export." };
  }

  const record = data as Record<string, unknown>;
  const keys = Object.keys(record)
    .map((key) => /^session(\d+)$/.exec(key))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => Number(match[1]))
    .sort((a, b) => a - b);
  if (keys.length === 0) {
    return {
      ok: false,
      error: "No sessions in that file. In csTimer, the export is under the menu's Export → Export to file.",
    };
  }

  const meta = sessionMeta(record.properties);
  const sessions: ImportedSession[] = [];
  const solves: ImportedSolve[] = [];
  let unreadable = 0;

  for (const index of keys) {
    const records = asArray(record[`session${index}`]) ?? [];
    const info = meta[String(index)] ?? {};
    const scrambleType =
      typeof info.opt?.scrType === "string"
        ? info.opt.scrType
        : typeof info.scr === "string"
          ? info.scr
          : DEFAULT_SCRAMBLE_TYPE;
    const name = typeof info.name === "string" || typeof info.name === "number" ? String(info.name) : String(index);

    if (records.length === 0) continue;

    if (!THREE_BY_THREE.has(scrambleType)) {
      sessions.push({
        index,
        name,
        scrambleType,
        records: records.length,
        usable: 0,
        skippedBecause: `not 3x3 (${scrambleType})`,
      });
      continue;
    }

    let usable = 0;
    for (const raw of records) {
      const solve = readSolve(raw);
      if (solve) {
        solves.push(solve);
        usable++;
      } else {
        unreadable++;
      }
    }
    sessions.push({ index, name, scrambleType, records: records.length, usable, skippedBecause: null });
  }

  solves.sort((a, b) => a.at - b.at);
  return { ok: true, sessions, solves, unreadable };
}

export interface Merge {
  solves: StoredSolve[];
  /** Imported solves added to history. */
  added: number;
  /** New to history but left out, because history was full. */
  leftOut: number;
  /** Already in history — from an earlier import of the same file. */
  alreadyHad: number;
}

/**
 * History with the imported solves merged in, in time order.
 *
 * An import never costs a solve already here. History holds `max`; what is
 * already in it stays, and imported solves fill whatever room is left, newest
 * first. The obvious version — merge, sort, keep the newest `max` — would let a
 * year of csTimer times push out solves recorded here, including the ones that
 * carry a replay, which nothing in a csTimer file can give back.
 *
 * Time order matters beyond tidiness: every trend here compares earlier solves
 * with later ones, and a year of csTimer history appended AFTER today's solves
 * would read as a sudden change in the cuber.
 */
export function mergeImported(
  existing: readonly StoredSolve[],
  imported: readonly StoredSolve[],
  max: number,
  /** Take at most this many — used when storage cannot hold all that would fit by count. */
  limit = Infinity,
): Merge {
  const known = new Set(existing.map((s) => s.id));
  const fresh = imported.filter((s) => !known.has(s.id)).sort((a, b) => a.at - b.at);
  const room = Math.min(limit, Math.max(0, max - existing.length));
  const taken = room === 0 ? [] : fresh.slice(-room);
  return {
    solves: [...existing, ...taken].sort((a, b) => a.at - b.at),
    added: taken.length,
    leftOut: fresh.length - taken.length,
    alreadyHad: imported.length - fresh.length,
  };
}
