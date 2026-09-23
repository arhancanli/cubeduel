import { AlgDemo } from "@/components/AlgDemo";
import { Reveal } from "@/components/Reveal";
import { REGION_LABEL, type SolveStep } from "@/lib/beginner";

/**
 * One step of a beginner guide: what you are aiming for, the idea in words, its
 * algorithms on a cube you can step through, and what it promises to leave
 * alone. Shared by the 3×3 and 2×2 guides so the two read the same way.
 */
export function GuideStep({ step, puzzle = "3x3x3" }: { step: SolveStep; puzzle?: "3x3x3" | "2x2x2" }) {
  // The Reveal goes INSIDE the li, not around it. An <ol> may only contain <li>
  // directly, and a wrapper div between them is invalid markup that also strips
  // the list of its meaning for anybody using a screen reader.
  return (
    <li id={step.slug} className="scroll-mt-8">
      <Reveal className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <div className="flex items-baseline gap-3">
            <span className="font-mono text-sm text-muted-dim">{step.number}</span>
            <h2 className="text-xl tracking-tight">{step.title}</h2>
          </div>
          <p className="max-w-xl text-sm leading-relaxed text-muted">{step.goal}</p>
        </div>

        <div className="flex max-w-xl flex-col gap-2.5">
          {step.idea.map((line, i) => (
            <p key={i} className="text-sm leading-relaxed text-muted-dim">
              {line}
            </p>
          ))}
        </div>

        {step.algorithms.length > 0 ? (
          <div
            className={`grid gap-6 ${
              step.algorithms.length > 1 ? "sm:grid-cols-2" : "sm:max-w-md"
            }`}
          >
            {step.algorithms.map((a) => (
              <div key={a.name} className="panel flex flex-col gap-3 rounded-xl p-4">
                <h3 className="text-sm">{a.name}</h3>
                {/* The algorithm is not printed twice. The move chips inside the
                    demo are the algorithm, and they also say where you are in
                    it — a second static copy above them was duplication. */}
                <AlgDemo alg={a.alg} label={a.name} hold="z2" puzzle={puzzle} />
                <p className="text-xs leading-relaxed text-muted-dim">{a.when}</p>
              </div>
            ))}
          </div>
        ) : null}

        {/* The promise. Derived from the puzzle, not asserted by the author —
            see the guide's test, which fails the build if they disagree. */}
        {step.preserves ? (
          <p className="flex max-w-xl items-start gap-2 text-xs leading-relaxed text-ready">
            <span aria-hidden="true">✓</span>
            <span>
              This will not touch {REGION_LABEL[step.preserves]}. Checked against
              the puzzle, not promised.
            </span>
          </p>
        ) : null}

        {step.note ? (
          <p className="max-w-xl border-l border-border pl-4 text-xs leading-relaxed text-muted-dim">
            {step.note}
          </p>
        ) : null}
      </Reveal>
    </li>
  );
}
