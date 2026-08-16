"use client";

import { useEffect, useState } from "react";

import Link from "next/link";

import { CubeView } from "@/components/CubeView";
import { MIN_OCCURRENCES, aggregateCases, buildNameTable, type CaseAggregate } from "@/lib/caseStats";
import { formatMs } from "@/lib/format";
import type { StoredSolve } from "@/lib/solveHistory";

const SHOWN = 4;

/**
 * The specific cases to drill.
 *
 * Each one is drawn as the flat last-layer diagram, because that is how cubers
 * recognise cases — a name is useless if you can't match it to what you're looking
 * at, and most of the 57 OLL cases have no name anyone uses anyway.
 *
 * Cases are ranked by recoverable time rather than by how slow they are: one you
 * meet every third solve and lose half a second on costs more than one you meet
 * monthly and fumble for four seconds.
 */
export function CaseCoach({ solves }: { solves: StoredSolve[] }) {
  const [names, setNames] = useState<ReadonlyMap<string, string>>(new Map());

  useEffect(() => {
    let cancelled = false;
    void buildNameTable().then((table) => {
      if (!cancelled) setNames(table);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const oll = aggregateCases(solves, "OLL", names).slice(0, SHOWN);
  const pll = aggregateCases(solves, "PLL", names).slice(0, SHOWN);

  if (oll.length === 0 && pll.length === 0) {
    return (
      <section className="flex flex-col gap-2">
        <h2 className="text-[10px] uppercase tracking-widest text-muted-dim">Cases to drill</h2>
        <p className="text-sm leading-relaxed text-muted-dim">
          Nothing to show yet. A case has to come up at least {MIN_OCCURRENCES} times before
          its average means anything — until then one bad solve would look like a weakness.
        </p>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-[10px] uppercase tracking-widest text-muted-dim">Cases to drill</h2>
        <p className="text-xs leading-relaxed text-muted-dim">
          Ranked by time you would get back, not by how slow they feel — how often the
          case comes up, times how much slower it is than your typical case at that stage.
        </p>
      </div>

      {oll.length > 0 ? <CaseRow title="OLL" cases={oll} /> : null}
      {pll.length > 0 ? <CaseRow title="PLL" cases={pll} /> : null}
    </section>
  );
}

function CaseRow({ title, cases }: { title: string; cases: CaseAggregate[] }) {
  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-xs text-muted">{title}</h3>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {cases.map((c) => (
          <CaseCard key={c.caseId} c={c} />
        ))}
      </div>
    </div>
  );
}

/**
 * Every card is a link to practising that exact case.
 *
 * The analysis page used to be terminal: it told you which case cost you the most
 * and then offered no way to do anything about it. The destination already existed
 * and the setup that reproduces the case was already stored — they were simply never
 * joined up, which made the most useful screen in the app a dead end.
 */
function CaseCard({ c }: { c: CaseAggregate }) {
  const body = (
    <>
      {c.setupAlg ? (
        <CubeView
                scramble={c.setupAlg}
                visualization="experimental-2D-LL"
                interactive={false}
          className="h-20 w-20"
        />
      ) : (
        <div className="h-20 w-20 rounded-md bg-surface" />
      )}
      <div className="flex flex-col items-center gap-0.5 text-center">
              {/*
                The diagram is the identifier. Printing "Unnamed case" as the
                brightest thing on the card labelled six of seven cards with a
                non-fact; where there is no certain name, the time is the headline
                and the algorithm below the picture is what you actually drill.
              */}
        {c.name ? <span className="text-xs text-muted">{c.name}</span> : null}
        <span className="tnum text-xs text-foreground">
          {formatMs(c.meanMs)} avg · {c.n}×
        </span>
        {/* A signed zero on a recoverable-time figure looks like a broken gauge. */}
        {c.excessMs >= 10 ? (
          <span className="tnum text-xs text-holding">−{formatMs(c.excessMs)} to gain</span>
        ) : null}
      </div>
    </>
  );

  if (!c.setupAlg) {
    return <div className="flex flex-col items-center gap-2">{body}</div>;
  }

  return (
    <Link
      href={`/play?scramble=${encodeURIComponent(c.setupAlg)}`}
      className="group flex flex-col items-center gap-2 rounded-lg p-2 transition-colors hover:bg-surface"
    >
      {body}
      <span className="text-xs text-muted-dim transition-colors group-hover:text-foreground">
        Drill this →
      </span>
    </Link>
  );
}
