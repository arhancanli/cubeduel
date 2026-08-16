"use client";

import pool from "@/data/scramble-pool.json";

/**
 * Scramble supply, in two tiers.
 *
 * Tier 1 is a buffer filled by the real random-state generator. It is kept three
 * deep so that by the time a solve ends the next scramble is already in memory —
 * generation costs ~200ms cold, and making a cuber wait for that after every solve
 * would be the most obvious flaw in the app.
 *
 * Tier 2 is a pre-generated pool that ships in the bundle. The generator is a
 * ~600KB WASM chunk, so on a phone there is over a second where tier 1 has nothing
 * and the screen would otherwise be empty. Pooled scrambles come from the same
 * generator and are equally WCA-legal, so the first scramble can be on screen at
 * hydration while WASM loads behind it.
 */

const BUFFER_TARGET = 3;

const buffers = new Map<string, string[]>();
const inFlight = new Map<string, Promise<void>>();

type ScrambleModule = typeof import("cubing/scramble");
let modulePromise: Promise<ScrambleModule> | null = null;

function loadModule(): Promise<ScrambleModule> {
  // Lazy so the WASM worker never reaches the server bundle, and never blocks
  // first paint.
  modulePromise ??= import("cubing/scramble");
  return modulePromise;
}

/**
 * Shuffled once per page load so reloading doesn't replay the same opening
 * scramble, and consumed rather than sampled so it can't repeat within a session.
 */
let poolQueue: string[] | null = null;

function takeFromPool(event: string): string | undefined {
  if (event !== pool.event) return undefined;
  if (poolQueue === null) {
    poolQueue = [...pool.scrambles];
    for (let i = poolQueue.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [poolQueue[i], poolQueue[j]] = [poolQueue[j], poolQueue[i]];
    }
  }
  return poolQueue.pop();
}

function bufferFor(event: string): string[] {
  let buffer = buffers.get(event);
  if (!buffer) {
    buffer = [];
    buffers.set(event, buffer);
  }
  return buffer;
}

async function fill(event: string): Promise<void> {
  const existing = inFlight.get(event);
  if (existing) return existing;

  const task = (async () => {
    try {
      const { randomScrambleForEvent } = await loadModule();
      const buffer = bufferFor(event);
      while (buffer.length < BUFFER_TARGET) {
        const alg = await randomScrambleForEvent(event);
        buffer.push(alg.toString());
      }
    } finally {
      inFlight.delete(event);
    }
  })();

  inFlight.set(event, task);
  return task;
}

/** Start loading the generator immediately — call on mount. */
export function warmScrambles(event = "333"): void {
  void fill(event).catch(() => {
    /* Retried on the next request; a warm-up failure must not surface as an error. */
  });
}

/**
 * Take the next scramble, topping the buffer back up in the background.
 * Never blocks on WASM while a pooled scramble is still available.
 */
export async function nextScramble(event = "333"): Promise<string> {
  const buffer = bufferFor(event);

  const generated = buffer.shift();
  if (generated) {
    void fill(event).catch(() => {});
    return generated;
  }

  const pooled = takeFromPool(event);
  if (pooled) {
    void fill(event).catch(() => {});
    return pooled;
  }

  // Pool exhausted and the buffer is dry — this is the only path that waits.
  await fill(event);
  const fallback = bufferFor(event).shift();
  if (!fallback) throw new Error(`Could not generate a scramble for ${event}`);
  return fallback;
}
