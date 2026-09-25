"use client";

import { useEffect, useRef, useState } from "react";

import type { SmartCubeFamily } from "@/lib/puzzleSource";

const FAMILIES: { id: SmartCubeFamily; title: string; models: string }[] = [
  { id: "gan", title: "GAN, MoYu AI or Monster Go", models: "GAN 12 ui, 356i Carry 2, 14 ui, Mini ui · MoYu AI 2023 · Monster Go AI" },
  { id: "classic", title: "Another smart cube", models: "GoCube · Giiker · Rubik's Connected · older GAN 356i" },
];

/**
 * "Connect a cube", then which kind. The two kinds speak different protocols
 * and open different device lists, so asking first is what makes each cube
 * appear in the list at all.
 */
export function ConnectCubeMenu({
  label,
  onConnect,
  className = "btn-secondary px-5 py-2.5 text-sm",
}: {
  label: string;
  onConnect: (family: SmartCubeFamily) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // A menu closes the way menus do: Escape, or a click anywhere else.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onClick = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onClick);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative inline-flex">
      <button
        type="button"
        aria-expanded={open}
        onClick={(click) => {
          click.currentTarget.blur();
          setOpen((o) => !o);
        }}
        className={className}
      >
        {label}
      </button>
      {open ? (
        // Floats over the page: opening it must not push anything out of place.
        <div
          role="menu"
          aria-label="Which cube?"
          data-testid="connect-menu"
          className="absolute left-0 top-full z-30 mt-2 flex w-72 max-w-[calc(100vw-2rem)] flex-col gap-1 rounded-xl border border-border bg-surface p-1.5 shadow-2xl"
        >
          <p className="px-2.5 pt-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-dim">Which cube is it?</p>
          {FAMILIES.map((f) => (
            <button
              key={f.id}
              type="button"
              role="menuitem"
              onClick={(click) => {
                // The browser only opens its Bluetooth list from a click, and this is it.
                click.currentTarget.blur();
                setOpen(false);
                onConnect(f.id);
              }}
              className="flex flex-col items-start gap-0.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-surface-hi"
            >
              <span className="text-sm font-semibold">{f.title}</span>
              <span className="text-xs text-muted-dim">{f.models}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
