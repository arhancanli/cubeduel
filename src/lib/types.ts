export type Penalty = "OK" | "PLUS2" | "DNF";

export interface Solve {
  id: string;
  /** Raw stopped time in ms, before any penalty is applied. */
  ms: number;
  penalty: Penalty;
  scramble: string;
  /** WCA event id, e.g. "333". */
  event: string;
  /** Epoch ms when the solve was recorded. */
  at: number;
}

export interface Session {
  id: string;
  name: string;
  event: string;
  solves: Solve[];
  createdAt: number;
}
