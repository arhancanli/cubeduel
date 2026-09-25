import assert from "node:assert/strict";
import { test } from "node:test";

import { Subject } from "rxjs";

import { ganPuzzle } from "./ganSource";

/** A cube that is not there: the same events a GAN cube sends, on demand. */
function fakeCube() {
  const events$ = new Subject<{ type: string; move?: string; timestamp: number }>();
  let disconnected = 0;
  return {
    connection: {
      deviceName: "GAN12ui_A1B2",
      events$,
      disconnect: async () => {
        disconnected++;
      },
    },
    send: (e: { type: string; move?: string }) => events$.next({ timestamp: 0, ...e }),
    disconnectedCount: () => disconnected,
  };
}

test("each turn of the cube reaches the timer as a move, stamped on the page's clock", () => {
  const cube = fakeCube();
  let clock = 1000;
  const puzzle = ganPuzzle(cube.connection, () => clock);
  const got: [string, number][] = [];
  puzzle.onMove((move, at) => got.push([move, at]));
  cube.send({ type: "MOVE", move: "R" });
  clock = 1180;
  cube.send({ type: "MOVE", move: "U'" });
  assert.deepEqual(got, [["R", 1000], ["U'", 1180]]);
});

test("what is not a turn — gyro, battery, facelets — is not a move", () => {
  const cube = fakeCube();
  const puzzle = ganPuzzle(cube.connection, () => 0);
  const got: string[] = [];
  puzzle.onMove((move) => got.push(move));
  for (const type of ["GYRO", "BATTERY", "FACELETS", "HARDWARE"]) cube.send({ type });
  cube.send({ type: "MOVE", move: "F2" });
  assert.deepEqual(got, ["F2"]);
});

test("the cube's own name is shown, and it is kept apart from the older cubes", () => {
  const puzzle = ganPuzzle(fakeCube().connection, () => 0);
  assert.equal(puzzle.name, "GAN12ui_A1B2");
  assert.equal(puzzle.kind, "smartcube");
});

test("a cube that drops out is reported, and nothing more is heard from it", () => {
  const cube = fakeCube();
  const puzzle = ganPuzzle(cube.connection, () => 0);
  let lost = 0;
  const got: string[] = [];
  puzzle.onDisconnect?.(() => lost++);
  puzzle.onMove((move) => got.push(move));
  cube.send({ type: "DISCONNECT" });
  cube.send({ type: "MOVE", move: "R" });
  assert.equal(lost, 1);
  assert.deepEqual(got, []);
});

test("disconnecting closes the Bluetooth connection and stops listening", () => {
  const cube = fakeCube();
  const puzzle = ganPuzzle(cube.connection, () => 0);
  const got: string[] = [];
  puzzle.onMove((move) => got.push(move));
  puzzle.disconnect();
  cube.send({ type: "MOVE", move: "R" });
  assert.equal(cube.disconnectedCount(), 1);
  assert.deepEqual(got, []);
});

test("unsubscribing one listener leaves the others", () => {
  const cube = fakeCube();
  const puzzle = ganPuzzle(cube.connection, () => 0);
  const a: string[] = [];
  const b: string[] = [];
  const stopA = puzzle.onMove((m) => a.push(m));
  puzzle.onMove((m) => b.push(m));
  stopA();
  cube.send({ type: "MOVE", move: "L" });
  assert.deepEqual([a, b], [[], ["L"]]);
});

test("disconnecting releases the subscription, not just the listeners", () => {
  let unsubscribed = 0;
  const connection = {
    deviceName: "GAN",
    events$: { subscribe: () => ({ unsubscribe: () => void unsubscribed++ }) },
    disconnect: () => {},
  };
  ganPuzzle(connection, () => 0).disconnect();
  assert.equal(unsubscribed, 1);
});

test("a cube that reports it is gone the moment it is listened to stays gone", () => {
  // Some streams replay their last event on subscribe — here, a disconnect —
  // before the subscription handle even exists to be closed.
  let push: ((e: { type: string; move?: string }) => void) | null = null;
  const connection = {
    deviceName: "GAN",
    events$: {
      subscribe: (next: (e: { type: string; move?: string }) => void) => {
        push = next;
        next({ type: "DISCONNECT" });
        return { unsubscribe: () => {} };
      },
    },
    disconnect: () => {},
  };
  const puzzle = ganPuzzle(connection, () => 0);
  const got: string[] = [];
  puzzle.onMove((m) => got.push(m));
  push!({ type: "MOVE", move: "R" });
  assert.deepEqual(got, []);
});
