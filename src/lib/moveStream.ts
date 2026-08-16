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
