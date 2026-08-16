"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";

import { CubeView } from "@/components/CubeView";
import { KeyMapHint } from "@/components/KeyMapHint";
import { SiteHeader } from "@/components/SiteHeader";
import { formatMs, formatRunning } from "@/lib/format";
import { useKeyboardSolve } from "@/lib/useKeyboardSolve";
import {
  MAX_BOX,
  cardBest,
  cardMean,
  nextCard,
  recordRep,
  summarise,
  type TrainingCard,
} from "@/lib/trainer";
import { buildDeck, saveDeck } from "@/lib/trainerDeck";

/**
 * The drill loop.
 *
 * A case is set up on the cube, you solve just that case, and the time you took
 * decides when you see it again. There is no "did you get it?" button, because
 * the app already knows — it watched the cube.
 *
 * The screen shows the target you are being measured against and where it came
 * from. A trainer that silently decides you failed, against a number you cannot
 * see, is a trainer people stop believing.
 */
export function TrainScreen() {
  const [cards, setCards] = useState<TrainingCard[] | null>(null);
  const [position, setPosition] = useState(0);
  /**
   * Identifies the drill currently mounted, and changes ONLY when the player
   * moves on. Keying the drill on `position` instead remounted it the moment a
   * rep was recorded, which reset the clock element and wiped the time that had
   * just been painted into it — the schedule still updated, so the only visible
   * symptom was a finished rep reading 0.00.
   */
  const [drillId, setDrillId] = useState(0);
  const [current, setCurrent] = useState<TrainingCard | null>(null);
  const [lastResult, setLastResult] = useState<{
    ms: number;
    promoted: boolean;
    target: number | null;
    best: boolean;
  } | null>(null);

  const displayRef = useRef<HTMLDivElement>(null);
  const cardsRef = useRef<TrainingCard[]>([]);
  const positionRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    void buildDeck().then((store) => {
      if (cancelled) return;
      cardsRef.current = store.cards;
      positionRef.current = store.position;
      setCards(store.cards);
      setPosition(store.position);
      setCurrent(nextCard(store.cards, store.position));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const advance = useCallback(() => {
    setLastResult(null);
    setCurrent(nextCard(cardsRef.current, positionRef.current));
    setDrillId((id) => id + 1);
  }, []);

  const handleSolved = useCallback(
    (durationMs: number) => {
      const card = current;
      if (!card) return;

      const previousBest = cardBest(card);
      const outcome = recordRep(
        card,
        durationMs,
        cardsRef.current,
        positionRef.current,
        Date.now(),
      );

      const nextCards = cardsRef.current.map((c) =>
        c.caseId === card.caseId ? outcome.card : c,
      );
      const nextPosition = positionRef.current + 1;

      cardsRef.current = nextCards;
      positionRef.current = nextPosition;
      setCards(nextCards);
      setPosition(nextPosition);
      saveDeck({ version: 1, cards: nextCards, position: nextPosition });

      setLastResult({
        ms: durationMs,
        promoted: outcome.promoted,
        target: outcome.target,
        best: previousBest === null || durationMs < previousBest,
      });
    },
    [current],
  );

  // Remounted only when the player advances, so the hook re-seeds the cube with
  // the next setup — and a finished rep keeps the time on screen until then.
  return (
    <main className="flex min-h-dvh flex-col">
      <SiteHeader active="train" />
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center gap-6 px-6 pb-16 pt-2">
        {cards === null ? (
          <p className="pt-20 text-sm text-muted-dim">Building your deck…</p>
        ) : cards.length === 0 ? (
          <EmptyDeck />
        ) : current === null ? (
          <p className="pt-20 text-sm text-muted-dim">Nothing due.</p>
        ) : (
          <Drill
            key={`${current.caseId}-${drillId}`}
            card={current}
            cards={cards}
            position={position}
            displayRef={displayRef}
            lastResult={lastResult}
            onSolved={handleSolved}
            onNext={advance}
          />
        )}
      </div>
    </main>
  );
}

function Drill({
  card,
  cards,
  position,
  displayRef,
  lastResult,
  onSolved,
  onNext,
}: {
  card: TrainingCard;
  cards: TrainingCard[];
  position: number;
  displayRef: React.RefObject<HTMLDivElement | null>;
  lastResult: {
    ms: number;
    promoted: boolean;
    target: number | null;
    best: boolean;
  } | null;
  onSolved: (ms: number) => void;
  onNext: () => void;
}) {
  const done = lastResult !== null;

  const { moveCount } = useKeyboardSolve({
    scramble: card.setupAlg,
    active: !done,
    // An OLL drill ends when the top is one colour. Waiting for a full solve
    // would fold PLL into every OLL time and corrupt the schedule.
    completion: card.stage === "OLL" ? "oriented" : "solved",
    displayRef,
    format: formatRunning,
    onSolved: (recording) => onSolved(recording.durationMs),
  });

  const summary = summarise(cards);
  const mean = cardMean(card);
  const best = cardBest(card);

  return (
    <>
      <div className="flex w-full flex-wrap items-center justify-between gap-3 text-xs text-muted-dim">
        <span>
          {card.stage} · {card.name ?? "unnamed case"}
        </span>
        <span>
          {summary.attempted}/{summary.total} cases seen · {summary.mastered}{" "}
          mastered · rep {position + 1}
        </span>
      </div>

      <CubeView
        scramble={card.setupAlg}
        backView="none"
        className="h-[30vh] max-h-72 min-h-40 w-full max-w-sm"
      />

      <div className="flex flex-col items-center gap-2">
        <div
          ref={displayRef}
          className={`tnum text-6xl font-medium leading-none tracking-tighter transition-colors sm:text-7xl ${
            done ? "text-ready" : "text-foreground"
          }`}
        >
          0.00
        </div>
        <p className="text-xs text-muted-dim">
          {done
            ? card.stage === "OLL"
              ? "Oriented"
              : "Solved"
            : `Solve the ${card.stage} — ${moveCount} moves`}
        </p>
      </div>

      {lastResult ? (
        <RepResult result={lastResult} stage={card.stage} />
      ) : (
        <CardHistory mean={mean} best={best} box={card.box} />
      )}

      {done ? (
        <button
          type="button"
          onClick={onNext}
          autoFocus
          className="rounded-lg bg-foreground px-6 py-2.5 text-sm font-medium text-background transition-opacity hover:opacity-90"
        >
          Next case
        </button>
      ) : null}

      {/*
        No touch pad here yet. `useKeyboardSolve` owns its own input connection
        and exposes no way to push a move into it, so a MovePad would render a
        row of buttons that silently do nothing. Drilling is keyboard-only until
        that hook takes an external move source.
      */}
      <div className="mt-2 hidden md:block">
        <KeyMapHint activeCode={null} />
      </div>

      <p className="text-center text-xs text-muted-dim md:hidden">
        Drilling needs a keyboard for now.
      </p>
    </>
  );
}

function RepResult({
  result,
  stage,
}: {
  result: { ms: number; promoted: boolean; target: number | null; best: boolean };
  stage: string;
}) {
  return (
    <div className="flex w-full max-w-sm flex-col items-center gap-2 rounded-lg border border-border bg-surface px-5 py-4 text-center">
      <p className="tnum text-2xl font-medium">{formatMs(result.ms)}</p>
      {result.best ? (
        <p className="text-xs text-ready">Best yet on this case.</p>
      ) : null}
      <p className="text-xs leading-relaxed text-muted-dim">
        {result.target === null ? (
          <>
            No target yet — it needs a few more cases before your own median means
            anything, so everything is moving forward for now.
          </>
        ) : result.promoted ? (
          <>
            Under your {stage} median of {formatMs(result.target, { truncate: false })}.
            You will see this one less often.
          </>
        ) : (
          <>
            Over your {stage} median of {formatMs(result.target, { truncate: false })}.
            Coming back sooner.
          </>
        )}
      </p>
    </div>
  );
}

function CardHistory({
  mean,
  best,
  box,
}: {
  mean: number | null;
  best: number | null;
  box: number;
}) {
  if (mean === null) {
    return (
      <p className="text-xs text-muted-dim">First time drilling this case.</p>
    );
  }
  return (
    <p className="text-xs text-muted-dim">
      Your average {formatMs(mean, { truncate: false })} · best {formatMs(best ?? 0)}{" "}
      · level {box}/{MAX_BOX}
    </p>
  );
}

function EmptyDeck() {
  return (
    <div className="max-w-md pt-20 text-center">
      <h1 className="text-xl font-medium tracking-tight">Nothing to drill yet.</h1>
      <p className="mt-4 text-sm leading-relaxed text-muted">
        The deck is built from cases your own solves actually produced, so there
        is nothing here until some solves have been analysed. That is deliberate:
        a canned list of 57 algorithms typed in by hand is a list of 57 chances to
        teach you the wrong finger trick.
      </p>
      <Link
        href="/play"
        className="mt-6 inline-block rounded-lg border border-border px-5 py-2.5 text-sm text-muted transition-colors hover:border-muted-dim hover:text-foreground"
      >
        Solve a few first
      </Link>
    </div>
  );
}
