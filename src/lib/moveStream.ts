/**
 * The one brain.
 *
 * Every way of solving a cube in this app — keyboard, Bluetooth smart cube, and
 * later a bot replaying a trajectory — produces the same thing: a sequence of
 * moves with timestamps, ending in a solved state. Everything downstream (the
 * timer, solve analysis, duels, the coach) consumes that sequence and nothing else.
 *
 * Keeping this shape single is what stops the app from growing a separate stack
 * per input device. cubing.js helps here: `KeyboardPuzzle` and every Bluetooth cube
 * class extend the same `BluetoothPuzzle` base and emit identical events, so the
 * recorder never learns which one it is attached to.
 */

/** Whole-cube rotations reorient the puzzle without turning a layer. */
const ROTATION_FAMILIES = new Set(["x", "y", "z"]);

export function isRotation(move: string): boolean {
  const family = move.replace(/^\d*/, "").replace(/['2]+$/, "");
  return ROTATION_FAMILIES.has(family);
}

export interface RecordedMove {
  /** Move in standard notation, e.g. "R", "U'", "F2". */
  move: string;
  /** Milliseconds from the start of the solve. */
  atMs: number;
  /** Gap since the previous counted move. */
  sincePrevMs: number;
  /** Rotations are recorded but do not count toward move count or TPS. */
  rotation: boolean;
}

export type RecorderPhase = "idle" | "armed" | "running" | "solved";

export interface SolveStats {
  /** Layer turns, excluding rotations. This is the number cubers mean by "moves". */
  moveCount: number;
  /** Turns per second over the solve — the standard measure of raw hand speed. */
  tps: number;
  durationMs: number;
  /**
   * The gaps that actually cost time. In cubing, a plateau is almost never slow
   * hands — it is pauses spent recognising what to do next, and those are
   * invisible on a stopwatch.
   */
  longestPauseMs: number;
  /** Index into `moves` of the move that ended the longest pause. */
  longestPauseAtIndex: number;
  /** Share of the solve spent not turning, using `pauseThresholdMs`. */
  pausedFraction: number;
}

export interface SolveRecording {
  moves: RecordedMove[];
  durationMs: number;
  solved: boolean;
  stats: SolveStats;
}

/** A gap longer than this reads as recognition rather than execution. */
export const PAUSE_THRESHOLD_MS = 350;

export function computeStats(
  moves: RecordedMove[],
  durationMs: number,
  pauseThresholdMs = PAUSE_THRESHOLD_MS,
): SolveStats {
  const turns = moves.filter((m) => !m.rotation);
  const seconds = durationMs / 1000;

  let longestPauseMs = 0;
  let longestPauseAtIndex = -1;
  let pausedMs = 0;

  moves.forEach((m, i) => {
    if (m.sincePrevMs > longestPauseMs) {
      longestPauseMs = m.sincePrevMs;
      longestPauseAtIndex = i;
    }
    if (m.sincePrevMs > pauseThresholdMs) pausedMs += m.sincePrevMs;
  });

  return {
    moveCount: turns.length,
    tps: seconds > 0 ? turns.length / seconds : 0,
    durationMs,
    longestPauseMs,
    longestPauseAtIndex,
    pausedFraction: durationMs > 0 ? Math.min(1, pausedMs / durationMs) : 0,
  };
}

interface RecorderCallbacks {
  /** Fires on the first layer turn, when the clock actually starts. */
  onStart?: (atMs: number) => void;
  onMove?: (move: RecordedMove, phase: RecorderPhase) => void;
  onSolved?: (recording: SolveRecording) => void;
}

/**
 * Turns a raw move feed into a timed solve.
 *
 * The clock starts on the first layer turn rather than the first event, so
 * rotating the cube to look at it does not begin the solve — that mirrors
 * inspection, where reorienting is free. It also means an accidental orientation
 * key can never silently start a run.
 */
export class SolveRecorder {
  private phase: RecorderPhase = "idle";
  private moves: RecordedMove[] = [];
  private startTimestamp = 0;
  private lastTimestamp = 0;
  private endTimestamp = 0;

  constructor(private callbacks: RecorderCallbacks = {}) {}

  /** Ready to record: the scramble is on the cube, waiting for the first turn. */
  arm(): void {
    this.phase = "armed";
    this.moves = [];
    this.startTimestamp = 0;
    this.lastTimestamp = 0;
    this.endTimestamp = 0;
  }

  reset(): void {
    this.phase = "idle";
    this.moves = [];
  }

  getPhase(): RecorderPhase {
    return this.phase;
  }

  getMoves(): readonly RecordedMove[] {
    return this.moves;
  }

  /** Elapsed time right now, for driving a live display. */
  elapsedAt(timestamp: number): number {
    if (this.phase === "solved") return this.endTimestamp - this.startTimestamp;
    if (this.phase !== "running") return 0;
    return timestamp - this.startTimestamp;
  }

  /**
   * Feed one move. `solved` comes from the puzzle pattern rather than being
   * inferred from the move list, so the solve ends the instant the cube is
   * actually solved — no move-count heuristics, no way to disagree with the cube.
   */
  handleMove(move: string, timestamp: number, solved: boolean): void {
    if (this.phase === "idle" || this.phase === "solved") return;

    const rotation = isRotation(move);

    if (this.phase === "armed") {
      // Rotations before the first turn are free, exactly like inspection.
      if (rotation) return;
      this.phase = "running";
      this.startTimestamp = timestamp;
      this.lastTimestamp = timestamp;
      this.callbacks.onStart?.(timestamp);
    }

    const recorded: RecordedMove = {
      move,
      atMs: timestamp - this.startTimestamp,
      sincePrevMs: timestamp - this.lastTimestamp,
      rotation,
    };
    this.lastTimestamp = timestamp;
    this.moves.push(recorded);
    this.callbacks.onMove?.(recorded, this.phase);

    if (solved) {
      this.phase = "solved";
      this.endTimestamp = timestamp;
      this.callbacks.onSolved?.(this.getRecording());
    }
  }

  getRecording(): SolveRecording {
    const durationMs =
      this.phase === "solved" ? this.endTimestamp - this.startTimestamp : 0;
    return {
      moves: [...this.moves],
      durationMs,
      solved: this.phase === "solved",
      stats: computeStats(this.moves, durationMs),
    };
  }
}

// ---------------------------------------------------------------------------
// Keeping the stream
// ---------------------------------------------------------------------------

/**
 * A solve's moves and timings as one short string, for storage.
 *
 * The move stream is the only thing this site has that a stopwatch does not, and
 * practice solves used to throw it away the moment the phase splits were worked
 * out — the local history kept the totals, sync sent the totals, and a practice
 * solve's permalink then told its owner it had been "entered by hand". The
 * splits can be recomputed from the stream; the stream cannot be recomputed from
 * anything.
 *
 * Why a string rather than the `{move, atMs}[]` everything else uses: local
 * history holds up to 2000 solves in a storage quota of about 5MB shared with
 * the rest of the site. As JSON objects a 60-move solve is about 1.8KB; as
 * `R.0 U.3c R'.2s …` — each move with the gap since the last in base 36 — it is
 * about 350 bytes, which puts a full history of streams near 0.7MB.
 *
 * Times are whole milliseconds. `performance.now()` gives fractions, and no human
 * input is meaningful below a millisecond; rounding each absolute time rather
 * than each gap keeps the error from accumulating over a long solve.
 */
export function encodeMoveStream(moves: readonly { move: string; atMs: number }[]): string {
  let previous = 0;
  return moves
    .map(({ move, atMs }) => {
      const at = Math.max(previous, Math.round(atMs));
      const token = `${move}.${(at - previous).toString(36)}`;
      previous = at;
      return token;
    })
    .join(" ");
}

/**
 * Notation this app produces: face, slice and wide turns, rotations, with an
 * optional layer prefix for big cubes. Anything else in a stored stream means
 * the record is corrupt or was not written by this code.
 */
const MOVE_PATTERN = /^\d{0,2}[UDLRFBMESudlrfbxyz]w?(?:2'?|'2?)?$/;

/** Long enough for any real solve, and a bound on what a request can make us parse. */
export const MAX_STREAM_MOVES = 2000;

/**
 * The inverse of `encodeMoveStream`, or null if the string is not one.
 *
 * Null rather than a partial result: a stream with a bad token in the middle has
 * lost its alignment, and every time after that point would be wrong in a way
 * nothing downstream could notice.
 */
export function decodeMoveStream(encoded: string): { move: string; atMs: number }[] | null {
  if (typeof encoded !== "string") return null;
  const trimmed = encoded.trim();
  if (trimmed === "") return [];

  const tokens = trimmed.split(/\s+/);
  if (tokens.length > MAX_STREAM_MOVES) return null;

  const moves: { move: string; atMs: number }[] = [];
  let at = 0;
  for (const token of tokens) {
    const dot = token.lastIndexOf(".");
    if (dot <= 0) return null;
    const move = token.slice(0, dot);
    const gap = token.slice(dot + 1);
    if (!MOVE_PATTERN.test(move) || !/^[0-9a-z]{1,7}$/.test(gap)) return null;
    at += parseInt(gap, 36);
    moves.push({ move, atMs: at });
  }
  return moves;
}

// ---------------------------------------------------------------------------
// Counting moves the way cubers count them
// ---------------------------------------------------------------------------

/** How many quarter turns clockwise a move is, and the layer it turns. */
function parseTurn(move: string): { layer: string; quarters: number } | null {
  const match = /^(\d*[A-Za-z]w?)(2'|'2|2|')?$/.exec(move);
  if (!match) return null;
  const suffix = match[2] ?? "";
  const quarters = suffix === "'" ? 3 : suffix === "" ? 1 : 2;
  return { layer: match[1], quarters };
}

/**
 * Moves in the half-turn metric, the count cubers and solvers both use: any
 * turn of one layer is one move, whatever its angle, and R R is R2 — one move.
 *
 * Keyboard and smart-cube input arrive as quarter turns, so a raw count of the
 * stream is in a different unit from every solver's answer. Comparing the two
 * directly overstates what a cuber wasted by one move for every half turn they
 * made, which is exactly the kind of wrong number this site refuses to print.
 *
 * Adjacent turns of the same layer merge, and cancel when they add up to
 * nothing (R R' is zero moves). Rotations are not moves, but they END a merge:
 * after a y, "R" names a different physical layer, so R y R is two moves on two
 * layers. Turns of opposite faces in between — R L R — are left unmerged too:
 * that is a real re-grip in the hands, and the conventional count leaves it.
 *
 * A middle-slice turn — M, E or S — is two. Every solver here answers in face
 * turns, where M is R L' with the cube turned, and counting it as one let a
 * cross built with slices come out "shorter than the shortest possible".
 */
export function countMoves(moves: readonly string[]): number {
  let count = 0;
  let layer: string | null = null;
  let quarters = 0;
  const flush = () => {
    if (layer !== null && quarters % 4 !== 0) count += /^[MES]$/.test(layer) ? 2 : 1;
  };
  for (const move of moves) {
    if (isRotation(move)) {
      flush();
      layer = null;
      quarters = 0;
      continue;
    }
    const turn = parseTurn(move);
    if (!turn) continue;
    if (turn.layer === layer) {
      quarters += turn.quarters;
    } else {
      flush();
      layer = turn.layer;
      quarters = turn.quarters;
    }
  }
  flush();
  return count;
}
