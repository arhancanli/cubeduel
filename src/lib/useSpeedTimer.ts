"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatRunning } from "./format";
import { useLatest } from "./useLatest";

export type TimerPhase = "idle" | "holding" | "ready" | "running" | "stopped";

/**
 * How long the spacebar must be held before the timer arms. A Stackmat needs
 * 0.55s; software timers sit lower because there is no physical travel. Anything
 * under ~250ms starts firing on accidental taps.
 */
export const DEFAULT_HOLD_MS = 300;

interface Options {
  holdThresholdMs?: number;
  /**
   * Phase names to collect splits for, e.g. ["Cross", "F2L", "OLL", "PLL"].
   *
   * With this set, space during a run marks the end of a phase instead of stopping;
   * the last one stops. It exists because the app's whole differentiator — knowing
   * *where* a solve went — otherwise requires move data, which a stopwatch cannot
   * see. Tapping four times is worse data than a smart cube and infinitely better
   * than none, and it works with the cube already in someone's hands.
   */
  splitLabels?: readonly string[];
  /** Fires with the elapsed milliseconds, plus cumulative split times if collected. */
  onComplete: (ms: number, splitsMs: number[]) => void;
  /** Fires when a running solve is abandoned with Escape. Nothing is recorded. */
  onCancel?: () => void;
  /** When false the timer ignores all input — used while dialogs are open. */
  enabled?: boolean;
}

/**
 * The WCA start sequence, as a state machine:
 *
 *   idle --space down--> holding --held long enough--> ready --space up--> running
 *                           |                                                |
 *                    released too soon                                  any key down
 *                           v                                                v
 *                         idle  <---------- all keys released ---------- stopped
 *
 * Releasing before the threshold cancels rather than starting, which is what
 * stops a stray tap from launching a solve.
 *
 * The running time is written straight to `displayRef` inside requestAnimationFrame
 * instead of going through React state — a 60fps setState would re-render the whole
 * tree every frame, and the timer is the one place jank is unforgivable. The hook is
 * the sole writer of that node's text so React never fights it.
 */
export function useSpeedTimer({
  holdThresholdMs = DEFAULT_HOLD_MS,
  splitLabels = [],
  onComplete,
  onCancel,
  enabled = true,
}: Options) {
  const [phase, setPhase] = useState<TimerPhase>("idle");
  /** How many phases have been marked in the current run. */
  const [splitIndex, setSplitIndex] = useState(0);
  const displayRef = useRef<HTMLElement | null>(null);

  const phaseRef = useRef<TimerPhase>("idle");
  const startedAtRef = useRef(0);
  const splitsRef = useRef<number[]>([]);
  const lastMsRef = useRef<number | null>(null);
  const lastLabelRef = useRef<string | null>(null);
  const holdTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rafRef = useRef<number | null>(null);

  // Callbacks live in refs so the global listeners can stay mounted for the
  // lifetime of the component instead of rebinding on every parent render.
  const onCompleteRef = useLatest(onComplete);
  const onCancelRef = useLatest(onCancel);

  const paint = useCallback((text: string) => {
    if (displayRef.current) displayRef.current.textContent = text;
  }, []);

  const paintStatic = useCallback(() => {
    // A penalty can override the number entirely — a DNF'd solve must read "DNF",
    // not fall back to a meaningless 0.00.
    if (lastLabelRef.current !== null) {
      paint(lastLabelRef.current);
      return;
    }
    paint(lastMsRef.current === null ? "0.00" : formatRunning(lastMsRef.current));
  }, [paint]);

  const setPhaseBoth = useCallback((next: TimerPhase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  const clearHoldTimeout = useCallback(() => {
    if (holdTimeoutRef.current !== null) {
      clearTimeout(holdTimeoutRef.current);
      holdTimeoutRef.current = null;
    }
  }, []);

  const stopRaf = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const tick = useCallback(() => {
    paint(formatRunning(performance.now() - startedAtRef.current));
    rafRef.current = requestAnimationFrame(tick);
  }, [paint]);

  const beginHold = useCallback(() => {
    if (phaseRef.current !== "idle") return;
    setPhaseBoth("holding");
    clearHoldTimeout();
    holdTimeoutRef.current = setTimeout(() => {
      if (phaseRef.current === "holding") setPhaseBoth("ready");
    }, holdThresholdMs);
  }, [clearHoldTimeout, holdThresholdMs, setPhaseBoth]);

  const releaseHold = useCallback(() => {
    const current = phaseRef.current;
    clearHoldTimeout();

    if (current === "ready") {
      startedAtRef.current = performance.now();
      splitsRef.current = [];
      setSplitIndex(0);
      setPhaseBoth("running");
      stopRaf();
      rafRef.current = requestAnimationFrame(tick);
      return;
    }
    if (current === "holding") {
      // Released before arming — treat as a misfire, not a start.
      setPhaseBoth("idle");
      paintStatic();
      return;
    }
    if (current === "stopped") {
      setPhaseBoth("idle");
    }
  }, [clearHoldTimeout, paintStatic, setPhaseBoth, stopRaf, tick]);

  const stopRunning = useCallback(
    (cancelled: boolean) => {
      if (phaseRef.current !== "running") return;
      const elapsed = performance.now() - startedAtRef.current;
      stopRaf();
      setPhaseBoth("stopped");

      if (cancelled) {
        paintStatic();
        onCancelRef.current?.();
        return;
      }

      lastMsRef.current = elapsed;
      lastLabelRef.current = null;
      paint(formatRunning(elapsed));
      onCompleteRef.current(elapsed, [...splitsRef.current]);
    },
    [paint, paintStatic, setPhaseBoth, stopRaf, onCancelRef, onCompleteRef],
  );

  /**
   * Lets the parent push a corrected value in after a penalty is toggled.
   * `label` replaces the number outright, for states like DNF that have no time.
   */
  const setDisplayedTime = useCallback(
    (ms: number | null, label: string | null = null) => {
      lastMsRef.current = ms;
      lastLabelRef.current = label;
      if (phaseRef.current !== "running") paintStatic();
    },
    [paintStatic],
  );

  useEffect(() => {
    paintStatic();
  }, [paintStatic]);

  useEffect(() => {
    if (!enabled) return;

    /** Somewhere text is being entered — the timer must never touch these keys. */
    const isTextEntry = (target: EventTarget | null) => {
      const el = target as HTMLElement | null;
      if (!el) return false;
      const tag = el.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
    };

    /**
     * A focused button or link. Space belongs to the control — pressing it must
     * activate the control, not arm the timer. Arming here recorded phantom solves
     * into real history, and on the daily it silently committed the one and only
     * attempt.
     *
     * This guards *arming* only. A running solve still stops on any key wherever
     * focus is: stopping the clock is the one action that must never be swallowed.
     */
    const isFocusedControl = (target: EventTarget | null) =>
      Boolean((target as HTMLElement | null)?.closest?.("a, button, [role='button']"));

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) return;
      if (isTextEntry(event.target)) return;
      // Leave browser shortcuts alone rather than swallowing them as a stop.
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      if (phaseRef.current === "running") {
        event.preventDefault();
        // In split mode space marks a phase boundary rather than stopping — until
        // the final one, which both marks and stops. Every other key still stops
        // outright, so a solve can always be ended even if the count goes wrong.
        if (
          splitLabels.length > 0 &&
          event.code === "Space" &&
          event.key !== "Escape" &&
          splitsRef.current.length < splitLabels.length - 1
        ) {
          splitsRef.current.push(performance.now() - startedAtRef.current);
          setSplitIndex(splitsRef.current.length);
          return;
        }
        if (splitLabels.length > 0 && event.code === "Space") {
          splitsRef.current.push(performance.now() - startedAtRef.current);
          setSplitIndex(splitsRef.current.length);
        }
        stopRunning(event.key === "Escape");
        return;
      }

      // A bare modifier press should not arm the timer.
      if (["Shift", "Control", "Alt", "Meta", "CapsLock"].includes(event.key)) return;

      if (event.code === "Space" && !isFocusedControl(event.target)) {
        event.preventDefault();
        beginHold();
      }
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (isTextEntry(event.target)) return;
      if (event.code === "Space" && isFocusedControl(event.target)) return;
      if (event.code === "Space" || phaseRef.current === "stopped") {
        event.preventDefault();
        releaseHold();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [beginHold, enabled, releaseHold, splitLabels, stopRunning]);

  useEffect(
    () => () => {
      clearHoldTimeout();
      stopRaf();
    },
    [clearHoldTimeout, stopRaf],
  );

  /**
   * Taps that land on a button or link belong to that control, not to the timer.
   * Without this, tapping "+2" on a phone also arms the timer surface underneath it.
   */
  const isInteractiveTarget = (target: EventTarget | null) =>
    Boolean(
      (target as HTMLElement | null)?.closest?.(
        // The cube view is included so dragging it to inspect the scramble never
        // arms the timer underneath.
        "a, button, input, textarea, select, twisty-player, [data-cube-view]",
      ),
    );

  /** Touch handlers for the timer surface — same machine, different input. */
  const touchHandlers = {
    onPointerDown: (event: React.PointerEvent) => {
      if (!enabled || event.pointerType === "mouse") return;
      if (isInteractiveTarget(event.target)) return;
      event.preventDefault();
      if (phaseRef.current === "running") {
        stopRunning(false);
        return;
      }
      beginHold();
    },
    onPointerUp: (event: React.PointerEvent) => {
      if (!enabled || event.pointerType === "mouse") return;
      if (isInteractiveTarget(event.target)) return;
      event.preventDefault();
      releaseHold();
    },
    onPointerCancel: () => {
      if (phaseRef.current === "holding" || phaseRef.current === "ready") {
        clearHoldTimeout();
        setPhaseBoth("idle");
        paintStatic();
      }
    },
  };

  return { phase, splitIndex, displayRef, touchHandlers, setDisplayedTime };
}
