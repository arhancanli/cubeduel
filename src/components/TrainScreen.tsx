"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";

import { CubeView } from "@/components/CubeView";
import { KeyMapHint } from "@/components/KeyMapHint";
import { MovePad } from "@/components/MovePad";
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
import { invertAlg, learnCases, type LearnCase } from "@/lib/learn";
import {
  addSet,
  cardsInSet,
  setCases,
  TRAIN_SET_KEY,
  TRAIN_SETS,
  type TrainSetId,
} from "@/lib/trainerSets";

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
  // What is being drilled. The whole deck is kept either way: a set only
  // decides which of its cards come up.
  const [setId, setSetId] = useState<TrainSetId>("yours");
  const setIdRef = useRef<TrainSetId>("yours");
  const casesRef = useRef<LearnCase[]>([]);
  const active = useCallback(
    (deck: readonly TrainingCard[]) => cardsInSet(deck, setIdRef.current, casesRef.current),
    [],
  );
  const positionRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([buildDeck(), learnCases()]).then(([store, cases]) => {
      if (cancelled) return;
      casesRef.current = cases;
      let chosen: TrainSetId = "yours";
      try {
        const stored = window.localStorage.getItem(TRAIN_SET_KEY);
        if (TRAIN_SETS.some((t) => t.id === stored)) chosen = stored as TrainSetId;
      } catch {
        /* storage blocked: start with your own cases */
      }
      setIdRef.current = chosen;
      setSetId(chosen);
      const deck = chosen === "yours" ? store.cards : addSet(store.cards, setCases(chosen, cases));
      if (deck !== store.cards) saveDeck({ version: 1, cards: deck, position: store.position });
      cardsRef.current = deck;
      positionRef.current = store.position;
      setCards(deck);
      setPosition(store.position);
      setCurrent(nextCard(active(deck), store.position));
    });
    return () => {
      cancelled = true;
    };
  }, [active]);

  const advance = useCallback(() => {
    setLastResult(null);
    setCurrent(nextCard(active(cardsRef.current), positionRef.current));
    setDrillId((id) => id + 1);
  }, [active]);

  const chooseSet = useCallback(
    (id: TrainSetId) => {
      setIdRef.current = id;
      setSetId(id);
      try {
        window.localStorage.setItem(TRAIN_SET_KEY, id);
      } catch {
        /* not worth failing over */
      }
      const deck = id === "yours" ? cardsRef.current : addSet(cardsRef.current, setCases(id, casesRef.current));
      cardsRef.current = deck;
      setCards(deck);
      saveDeck({ version: 1, cards: deck, position: positionRef.current });
      setLastResult(null);
      setCurrent(nextCard(active(deck), positionRef.current));
      setDrillId((n) => n + 1);
    },
    [active],
  );

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
      {/* The page title, for assistive tech. This screen is deliberately
          chrome-free — a visible heading beside the clock would be noise. */}
      <h1 className="sr-only">Case trainer</h1>
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center gap-6 px-4 pb-16 pt-4 sm:px-6 lg:pt-8">
        {/* What this is, in one line. It used to open straight onto a case with
            "0/6 cases seen · rep 1" and nothing saying what any of that meant. */}
        <div className="w-full rounded-2xl border border-border bg-surface px-5 py-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-sticker-green">Train</p>
          <p className="mt-1 text-sm leading-relaxed text-muted">
            The cube is set up in a last-layer case: solve it on the keyboard. Slow cases come back
            sooner, fast ones later, until each is mastered.{" "}
            <Link href="/learn" className="font-semibold text-foreground underline decoration-border underline-offset-4 hover:decoration-current">
              Every algorithm
            </Link>
          </p>
          <div className="mt-4 flex flex-col gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-dim">What to drill</p>
            <div role="radiogroup" aria-label="What to drill" className="flex flex-wrap gap-1.5">
              {TRAIN_SETS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="radio"
                  aria-checked={setId === t.id}
                  onClick={(click) => {
                    // Focus would take the keys away from the cube.
                    click.currentTarget.blur();
                    chooseSet(t.id);
                  }}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                    setId === t.id ? "bg-foreground text-background" : "bg-surface-hi text-muted hover:text-foreground"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        </div>
        {cards === null ? (
          <p className="pt-20 text-sm text-muted-dim">Building your deck…</p>
        ) : active(cards).length === 0 ? (
          <EmptyDeck />
        ) : current === null ? (
          <p className="pt-20 text-sm text-muted-dim">Nothing due.</p>
        ) : (
          <Drill
            key={`${current.caseId}-${drillId}`}
            card={current}
            cards={active(cards)}
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

  const { moveCount, pushMove } = useKeyboardSolve({
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
      <div className="flex w-full flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col">
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-dim">
            {card.stage === "OLL" ? "Orient the top" : "Permute the top"}
          </span>
          <span className="font-display text-2xl font-bold">
            {card.stage} · {card.name ?? "unnamed case"}
          </span>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="rounded-lg bg-surface-hi px-2.5 py-1 text-muted" data-testid="train-progress">
            <span className="tnum font-semibold text-foreground">{summary.attempted}</span> of{" "}
            <span className="tnum">{summary.total}</span> drilled
          </span>
          <span className="rounded-lg bg-surface-hi px-2.5 py-1 text-muted">
            <span className="tnum font-semibold text-foreground">{summary.mastered}</span> mastered
          </span>
        </div>
      </div>

      <CubeView
        scramble={card.setupAlg}
        backView="none"
        className="h-[30vh] max-h-72 min-h-40 w-full max-w-sm"
      />

      <div className="flex flex-col items-center gap-2">
        <div
          ref={displayRef}
          className={`tnum font-display text-6xl font-bold leading-none tracking-tighter transition-colors sm:text-7xl ${
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
          className="btn-go px-6 py-2.5 text-sm"
        >
          Next case
        </button>
      ) : null}

      {done ? null : <MovePad onMove={pushMove} className="md:hidden" />}

      <AlgorithmHint key={card.caseId} setupAlg={card.setupAlg} />

      {/* Reference, not the point of the page: folded away until wanted. */}
      <details className="mt-2 hidden w-full md:block">
        <summary className="cursor-pointer text-center text-xs font-semibold text-muted-dim hover:text-foreground">
          Keyboard controls
        </summary>
        <div className="pt-4">
          <KeyMapHint activeCode={null} />
        </div>
      </details>
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
    <div className="max-w-md pt-12 text-center">
      <h2 className="text-xl tracking-tight">No cases from your solves yet.</h2>
      <p className="mt-4 text-sm leading-relaxed text-muted">
        They appear here once a few keyboard or smart-cube solves have been read. To start now,
        pick a set above — all of PLL, or OLL one shape at a time.
      </p>
      <Link href="/play" className="btn-secondary mt-6 inline-block px-5 py-2.5 text-sm">
        Solve a few first
      </Link>
    </div>
  );
}

/**
 * The algorithm, on request. Shown straight away it would be read instead of
 * recalled; hidden completely, a case you do not know yet could not be learned
 * here at all.
 */
function AlgorithmHint({ setupAlg }: { setupAlg: string }) {
  const [shown, setShown] = useState(false);
  return shown ? (
    <p className="max-w-md text-center font-mono text-sm tracking-wide text-muted" data-testid="train-algorithm">
      {invertAlg(setupAlg)}
    </p>
  ) : (
    <button
      type="button"
      onClick={(click) => {
        click.currentTarget.blur();
        setShown(true);
      }}
      className="text-xs font-semibold text-muted-dim underline decoration-border underline-offset-4 hover:text-foreground"
    >
      Show the algorithm
    </button>
  );
}
