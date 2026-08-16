"use client";

import { useEffect, useRef } from "react";

/**
 * A ref that always holds the most recent value, without that value becoming an
 * effect dependency.
 *
 * This app needs it in nine places, all the same shape: an effect that must run
 * **once** — connecting a keyboard, building a Three.js scene, arming a solve
 * recorder — but whose callbacks need the current props when they eventually
 * fire. Putting the callback in the dependency array instead would tear down and
 * rebuild the input device or the 3D scene on every render, which drops moves
 * mid-solve.
 *
 * The obvious implementation assigns during render:
 *
 *     const ref = useRef(value);
 *     ref.current = value;      // <- wrong
 *
 * That is what this replaces. React may render a component and then throw the
 * result away — concurrent rendering, an interrupted transition, StrictMode's
 * double invoke — and a ref written during a discarded render keeps a value that
 * was never committed. It happens to work today and is a genuine correctness
 * trap, which is why React's own lint rule rejects it.
 *
 * Assigning in an effect writes only after the render is actually committed.
 *
 * One ordering rule that matters: effects run in declaration order, so call this
 * **before** any effect that reads the ref. Every caller here does, and in
 * practice the reads happen in async callbacks long after mount anyway. On the
 * very first render `useRef(value)` already holds the right value, so mount-time
 * reads are correct either way.
 */
export function useLatest<T>(value: T): { readonly current: T } {
  const ref = useRef(value);

  // No dependency array: this must re-run after every commit, because the point
  // is to track a value that deliberately is not a dependency anywhere else.
  useEffect(() => {
    ref.current = value;
  });

  return ref;
}
