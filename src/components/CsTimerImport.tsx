"use client";

import { useRef, useState } from "react";

import { track } from "@/lib/analytics";
import { parseCsTimerExport, type CsTimerParse } from "@/lib/cstimerImport";
import { importSolves } from "@/lib/solveHistory";
import { resyncFrom } from "@/lib/sync";

/**
 * Bring a csTimer history across.
 *
 * The file is read here, in the browser, and never uploaded to be parsed: it is
 * somebody's whole solving history, and nothing about reading it needs a server.
 * What reaches the server afterwards is what sync sends for any solve — and only
 * for somebody signed in.
 *
 * Two steps rather than one, deliberately. A history file can hold a dozen
 * sessions across events, and the only honest thing to do before writing
 * anything is to say which of them are coming across and which are not, and
 * why. Importing on file selection would leave somebody to discover afterwards
 * that their 2x2 session was left behind.
 */

/** A csTimer export of 100,000 solves is about 10MB; this is well past any real one. */
const MAX_FILE_BYTES = 50 * 1024 * 1024;

type State =
  | { kind: "idle" }
  | { kind: "error"; message: string }
  | { kind: "preview"; parsed: Extract<CsTimerParse, { ok: true }> }
  | { kind: "done"; added: number; alreadyHad: number; leftOut: number; storageFull: boolean };

export function CsTimerImport({ onImported }: { onImported?: () => void }) {
  const [state, setState] = useState<State>({ kind: "idle" });
  const input = useRef<HTMLInputElement>(null);

  async function read(file: File) {
    if (file.size > MAX_FILE_BYTES) {
      setState({ kind: "error", message: "That file is far larger than any csTimer export." });
      return;
    }
    const parsed = parseCsTimerExport(await file.text());
    if (!parsed.ok) {
      setState({ kind: "error", message: parsed.error });
      return;
    }
    if (parsed.solves.length === 0) {
      setState({
        kind: "error",
        message: "That export has no 3x3 solves in it. Other events are not brought across yet.",
      });
      return;
    }
    setState({ kind: "preview", parsed });
  }

  function commit(parsed: Extract<CsTimerParse, { ok: true }>) {
    const result = importSolves(parsed.solves);
    if (!result.saved) {
      setState({
        kind: "error",
        message:
          "Your browser would not let this site store them — private browsing, most often. Nothing was imported.",
      });
      return;
    }
    if (result.added > 0) {
      resyncFrom(parsed.solves[0].at);
      track("cstimer_import", { added: result.added });
    }
    setState({
      kind: "done",
      added: result.added,
      alreadyHad: result.alreadyHad,
      leftOut: result.leftOut,
      storageFull: result.storageFull,
    });
    onImported?.();
  }

  return (
    <section className="flex flex-col gap-3" data-testid="cstimer-import">
      <h2 className="text-[10px] uppercase tracking-widest text-muted-dim">Bring your csTimer history</h2>

      {/* One input for every state, so a second file — another device's
          export, a newer one — can be brought in without reloading the page. */}
      <input
        ref={input}
        type="file"
        accept=".txt,.json,application/json,text/plain"
        className="sr-only"
        aria-label="csTimer export file"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void read(file);
        }}
      />

      {state.kind === "idle" || state.kind === "error" ? (
        <>
          <p className="max-w-lg text-sm leading-relaxed text-muted">
            In csTimer, open the menu, choose <span className="text-foreground">Export</span> and{" "}
            <span className="text-foreground">Export to file</span>, then pick that file here. It
            is read in your browser and not uploaded.
          </p>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => input.current?.click()}
              className="rounded-lg border border-border px-4 py-2 text-sm text-foreground transition-colors hover:border-muted-dim"
            >
              Choose a csTimer file
            </button>
          </div>
          {state.kind === "error" ? (
            <p role="alert" className="text-sm text-danger">
              {state.message}
            </p>
          ) : null}
        </>
      ) : null}

      {state.kind === "preview" ? <Preview parsed={state.parsed} onCommit={commit} onCancel={() => setState({ kind: "idle" })} /> : null}

      {state.kind === "done" ? (
        <div className="flex flex-col gap-2" role="status">
          <p className="text-sm text-foreground">
            {state.added > 0
              ? `Added ${state.added.toLocaleString()} solve${state.added === 1 ? "" : "s"} from csTimer.`
              : "Nothing new — every solve in that file is already here."}
          </p>
          <p className="max-w-lg text-xs leading-relaxed text-muted-dim">
            {state.alreadyHad > 0 ? `${state.alreadyHad.toLocaleString()} were already here from an earlier import. ` : ""}
            {state.leftOut > 0
              ? state.storageFull
                ? `${state.leftOut.toLocaleString()} older ones did not fit in this browser's storage, and nothing already here is given up to make room. `
                : `${state.leftOut.toLocaleString()} older ones did not fit: history keeps 2,000 solves, and nothing already here is ever pushed out to make room. `
              : ""}
            They count toward your totals, bests, goals and trend. They cannot be split by phase
            or reach the ladder — a csTimer file has times, not turns.
          </p>
          <button
            type="button"
            onClick={() => input.current?.click()}
            className="self-start text-sm text-muted underline-offset-4 hover:text-foreground hover:underline"
          >
            Import another file
          </button>
        </div>
      ) : null}
    </section>
  );
}

function Preview({
  parsed,
  onCommit,
  onCancel,
}: {
  parsed: Extract<CsTimerParse, { ok: true }>;
  onCommit: (parsed: Extract<CsTimerParse, { ok: true }>) => void;
  onCancel: () => void;
}) {
  const total = parsed.solves.length;
  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-1 text-xs">
        {parsed.sessions.map((session) => (
          <li key={session.index} className="flex items-baseline gap-3">
            <span className="w-32 truncate text-muted">
              {/* csTimer names sessions 1, 2, 3 until somebody renames them. */}
              {/^\d+$/.test(session.name) ? `Session ${session.name}` : session.name}
            </span>
            <span className="tnum w-24 text-right text-foreground">
              {session.skippedBecause === null ? `${session.usable.toLocaleString()} solves` : "—"}
            </span>
            <span className="text-muted-dim">
              {session.skippedBecause === null
                ? session.usable < session.records
                  ? `${(session.records - session.usable).toLocaleString()} unreadable`
                  : ""
                : `left out: ${session.skippedBecause}`}
            </span>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => onCommit(parsed)}
          className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90"
        >
          Import {total.toLocaleString()} solve{total === 1 ? "" : "s"}
        </button>
        <button type="button" onClick={onCancel} className="px-2 py-2 text-sm text-muted-dim hover:text-muted">
          Cancel
        </button>
      </div>
      <p className="max-w-lg text-xs leading-relaxed text-muted-dim">
        3x3 only for now. History keeps 2,000 solves; if these do not all fit, the newest come
        across and nothing already here is pushed out.
      </p>
    </div>
  );
}
