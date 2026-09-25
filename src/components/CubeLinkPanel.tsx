"use client";

import { ConnectCubeMenu } from "@/components/ConnectCubeMenu";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { CubeView, type CubePlayer } from "@/components/CubeView";
import {
  calibrated,
  connected,
  connecting,
  describe,
  failed,
  IDLE,
  isTrustworthy,
  lost,
  moved,
  simulatedCube,
  type LinkState,
} from "@/lib/cubeLink";
import {
  connectSmartCube,
  type SmartCubeFamily,
  smartCubeSupport,
  type ConnectedPuzzle,
  type SmartCubeSupport,
} from "@/lib/puzzleSource";

/**
 * Your cube, on the screen.
 *
 * Turn the puzzle in your hands and the one here turns with it. That is the
 * whole feature, and it is worth more than it sounds: it is the only way to know
 * the link is actually working before you trust a solve to it.
 *
 * The flow has a step most implementations skip. A Bluetooth cube reports moves
 * and never state, so between connecting and mirroring there has to be a moment
 * where the person says "my cube is solved" — otherwise the app is guessing, and
 * a wrong guess produces a screen that is confidently, silently wrong. See
 * `cubeLink.ts`.
 */
export function CubeLinkPanel() {
  const [state, setState] = useState<LinkState>(IDLE);
  const [support, setSupport] = useState<SmartCubeSupport | null>(null);
  const [demo, setDemo] = useState(false);

  const playerRef = useRef<CubePlayer | null>(null);
  const simulated = useRef<ReturnType<typeof simulatedCube> | null>(null);
  const puzzleRef = useRef<ConnectedPuzzle | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const trusted = useRef(false);

  // Resolved after mount: `navigator` does not exist on the server, and probing
  // during render makes the two trees disagree.
  useEffect(() => setSupport(smartCubeSupport()), []);

  const attach = useCallback((puzzle: ConnectedPuzzle) => {
    puzzleRef.current = puzzle;
    unsubscribeRef.current?.();
    unsubscribeRef.current = puzzle.onMove((move) => {
      // Moves arriving before calibration are dropped rather than shown. Showing
      // them would animate a cube that does not match the one being turned,
      // which is exactly the lie this flow exists to prevent.
      if (!trusted.current) return;
      playerRef.current?.experimentalAddMove(move);
      setState(moved);
    });
  }, []);

  const connect = useCallback(async (family: SmartCubeFamily = "classic") => {
    setState(connecting);
    try {
      const puzzle = await connectSmartCube(family);
      trusted.current = false;
      attach(puzzle);
      setState(connected(puzzle.name));
      // A cube that drops out goes back to "Reconnect", not a silent dead view.
      puzzle.onDisconnect?.(() => {
        if (puzzleRef.current !== puzzle) return;
        trusted.current = false;
        setState(lost);
      });
    } catch (error) {
      setState((previous) => failed(previous, error));
    }
  }, [attach]);

  // A cube that is not there, so the flow can be walked through — and tested —
  // without hardware. Labelled as simulated everywhere it appears; a demo that
  // could be mistaken for a real connection would be worse than no demo.
  const startDemo = useCallback(() => {
    const puzzle = simulatedCube();
    simulated.current = puzzle;
    trusted.current = false;
    setDemo(true);
    attach(puzzle);
    setState(connected(puzzle.name));
  }, [attach]);

  const confirmSolved = useCallback(() => {
    trusted.current = true;
    playerRef.current?.removeAttribute("alg");
    playerRef.current?.setAttribute("experimental-setup-alg", "");
    setState(calibrated);
  }, []);

  const disconnect = useCallback(() => {
    trusted.current = false;
    unsubscribeRef.current?.();
    puzzleRef.current?.disconnect();
    puzzleRef.current = null;
    setDemo(false);
    setState(lost);
  }, []);

  useEffect(() => {
    return () => {
      unsubscribeRef.current?.();
      puzzleRef.current?.disconnect();
    };
  }, []);

  const live = isTrustworthy(state);

  /**
   * The simulated cube turns itself, because a demonstration that waits for you
   * to turn a cube you do not own demonstrates nothing.
   *
   * It goes through a sune and back so the cube visibly returns to solved — a
   * loop that drifts further from home every cycle would look like a bug.
   */
  useEffect(() => {
    if (!demo || !live) return;
    const cube = simulated.current;
    if (!cube) return;

    const sequence = "R U R' U R U2 R' R U2 R' U' R U' R'".split(" ");
    let i = 0;
    const id = setInterval(() => {
      cube.turn(sequence[i % sequence.length]);
      i++;
    }, 700);
    return () => clearInterval(id);
  }, [demo, live]);

  return (
    <div className="grid items-start gap-10 md:grid-cols-[minmax(0,1fr)_minmax(0,20rem)]">
      <div className="cube-stage relative mx-auto aspect-square w-full max-w-lg">
        <CubeView
          scramble=""
          interactive
          backView="top-right"
          onPlayerReady={(player) => {
            playerRef.current = player;
          }}
          className="h-full w-full"
        />
      </div>

      <div className="panel flex flex-col gap-6 rounded-2xl p-5">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className={`h-2 w-2 rounded-full ${
                live ? "bg-ready" : state.status === "lost" ? "bg-danger" : "bg-muted-dim"
              }`}
            />
            <h2 className="text-sm">
              {state.name ?? "No cube connected"}
              {demo ? <span className="ml-2 text-xs text-holding">simulated</span> : null}
            </h2>
          </div>
          <p role="status" className="text-xs leading-relaxed text-muted">
            {describe(state)}
          </p>
          {state.error ? (
            <p role="alert" className="text-xs leading-relaxed text-danger">
              {state.error}
            </p>
          ) : null}
        </div>

        {/* ---------------------------------------------------------------- */}
        {state.status === "needs-calibration" ? (
          <div className="flex flex-col gap-3">
            <button
              type="button"
              onClick={confirmSolved}
              className="btn-go px-5 py-2.5 text-sm"
            >
              My cube is solved
            </button>
            <p className="text-xs leading-relaxed text-muted-dim">
              Solve the cube in your hands first. A smart cube reports which way
              it was turned, never what it looks like — so this has to be told
              where to start, once. Get it wrong and everything after it is wrong
              too, quietly.
            </p>
          </div>
        ) : null}

        {state.status === "idle" || state.status === "lost" ? (
          <div className="flex flex-col gap-3">
            {support?.supported ? (
              <ConnectCubeMenu
                label={state.status === "lost" ? "Reconnect" : "Connect a cube"}
                onConnect={(family) => void connect(family)}
                className="btn-go px-5 py-2.5 text-sm"
              />
            ) : (
              <p className="text-xs leading-relaxed text-muted">
                {support?.reason ?? "Checking what this browser can do…"}
              </p>
            )}

            <button
              type="button"
              onClick={startDemo}
              className="rounded-lg border border-border px-5 py-2.5 text-sm transition-colors hover:border-muted-dim"
            >
              Show me how it works
            </button>
            <p className="text-xs leading-relaxed text-muted-dim">
              Walks through the same steps with a cube that is not there, so you
              can see what to expect before buying one.
            </p>
          </div>
        ) : null}

        {live ? (
          <div className="flex flex-col gap-3">
            <p className="text-xs leading-relaxed text-muted-dim">
              Everything on this site takes turns from here now — the timer, the
              drills, and every case in{" "}
              <Link href="/learn" className="text-foreground underline underline-offset-4">
                the last layer
              </Link>
              .
            </p>
            <button
              type="button"
              onClick={disconnect}
              className="self-start text-xs text-muted-dim underline underline-offset-4 transition-colors hover:text-danger"
            >
              Disconnect
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
