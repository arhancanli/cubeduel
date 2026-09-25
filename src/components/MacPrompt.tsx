"use client";

import { useEffect, useRef, useState } from "react";

import { normalizeMac, usePendingMac } from "@/lib/macPrompt";

/**
 * Asks for a GAN cube's Bluetooth address, only when Chrome would not reveal
 * it. Mounted once for the whole site, so every page that connects a cube gets
 * it. Asked once per cube; the answer is remembered.
 */
export function MacPrompt() {
  const pending = usePendingMac();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (pending) {
      setValue("");
      setError(null);
      window.setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [pending]);

  useEffect(() => {
    if (!pending) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") pending.resolve(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pending]);

  if (!pending) return null;

  const submit = () => {
    const mac = normalizeMac(value);
    if (!mac) {
      setError("That isn't a Bluetooth address. It looks like AB:12:CD:34:EF:56 — six pairs of letters and numbers.");
      return;
    }
    pending.resolve(mac);
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 px-4" role="presentation">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="mac-title"
        data-testid="mac-prompt"
        className="flex w-full max-w-md flex-col gap-4 rounded-2xl border border-border bg-surface p-6 shadow-2xl"
      >
        <h2 id="mac-title" className="text-lg">
          One more step for {pending.deviceName || "your cube"}
        </h2>
        <p className="text-sm leading-relaxed text-muted">
          This cube scrambles what it sends, and unlocking it needs its Bluetooth address. Chrome
          would not share it, so it is asked for once and remembered.
        </p>
        <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-sm leading-relaxed text-muted">
          <li>
            Open a new tab at <span className="font-mono text-foreground">chrome://bluetooth-internals/#devices</span>{" "}
            and press <span className="text-foreground">Start scan</span>.
          </li>
          <li>Find your cube by name and copy its address.</li>
        </ol>
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <label htmlFor="mac-input" className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-dim">
            Bluetooth address
          </label>
          <input
            id="mac-input"
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="AB:12:CD:34:EF:56"
            autoComplete="off"
            spellCheck={false}
            className="rounded-lg border border-border bg-background px-3 py-2.5 font-mono text-sm outline-none focus:border-muted-dim"
          />
          {error ? <p className="text-xs text-danger" role="alert">{error}</p> : null}
          <div className="flex gap-2 pt-1">
            <button type="submit" className="btn-go px-5 py-2.5 text-sm">
              Connect
            </button>
            <button
              type="button"
              onClick={() => pending.resolve(null)}
              className="btn-secondary px-5 py-2.5 text-sm"
            >
              Cancel
            </button>
          </div>
        </form>
        <p className="text-xs leading-relaxed text-muted-dim">
          To skip this for every cube, turn on{" "}
          <span className="font-mono">chrome://flags/#enable-experimental-web-platform-features</span> and
          restart Chrome — it lets the site read the address itself.
        </p>
      </div>
    </div>
  );
}
