import { Glyph } from "@/components/Glyph";
import { KeyMapHint } from "@/components/KeyMapHint";
import { faceFor, stickerVar, type FaceKey } from "@/lib/modes";

/**
 * The frame every competitive mode is played in.
 *
 * The same shape as the timer and keyboard screens, so moving between modes
 * never means relearning where things are: the mode's name and colour at the
 * top with its own controls beside it, the solve in the middle, and down the
 * right the numbers this mode keeps, how it works, and the keys. Each used to
 * be its own centred stack of grey text with the rules as a paragraph and the
 * key map as a wall underneath.
 */
export function ModeLayout({
  face,
  title,
  blurb,
  controls,
  dim = false,
  children,
  aside,
  glyph,
}: {
  face: FaceKey;
  /** A pattern of its own for a page played under another face's rules. */
  glyph?: string;
  title: string;
  blurb: string;
  /** Beside the title — an event picker, usually. */
  controls?: React.ReactNode;
  /** Fades the chrome while a solve is running. */
  dim?: boolean;
  children: React.ReactNode;
  aside?: React.ReactNode;
}) {
  const mode = faceFor(face);
  const fade = `transition-opacity duration-200 ${dim ? "opacity-20" : "opacity-100"}`;
  return (
    <div className="mx-auto grid w-full max-w-7xl flex-1 items-start gap-6 px-4 pb-10 pt-3 sm:px-8 lg:grid-cols-[minmax(0,1fr)_21rem] lg:gap-8 lg:pt-8">
      <div className="flex min-w-0 flex-col items-center gap-5 md:gap-6">
        <header className={`flex w-full flex-wrap items-center justify-between gap-4 ${fade}`}>
          <div className="flex items-center gap-3">
            <Glyph pattern={glyph ?? mode.glyph} sticker={mode.sticker} size={34} />
            <div className="flex flex-col">
              <h1 className="text-3xl leading-tight">{title}</h1>
              <p className="text-sm text-muted">{blurb}</p>
            </div>
          </div>
          {controls}
        </header>
        <span aria-hidden="true" className={`h-1 w-full rounded-full ${fade}`} style={{ background: stickerVar(mode.sticker), opacity: dim ? 0.2 : 0.9 }} />
        {children}
      </div>
      {aside ? (
        <aside className={`flex flex-col gap-4 lg:sticky lg:top-6 ${fade}`}>{aside}</aside>
      ) : null}
    </div>
  );
}

/** The scramble, in a card, labelled. */
export function ScrambleCard({
  scramble,
  label = "Scramble · already applied",
  note,
  dim = false,
  placeholder = "Your scramble appears when you start.",
}: {
  scramble: string | null;
  label?: string;
  note?: string;
  dim?: boolean;
  placeholder?: string;
}) {
  return (
    <section
      className={`w-full rounded-2xl border border-border bg-surface px-4 py-4 transition-opacity duration-200 sm:px-6 ${
        dim ? "opacity-30" : "opacity-100"
      }`}
    >
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-dim">{label}</span>
        {note ? <span className="text-[11px] text-muted-dim">{note}</span> : null}
      </div>
      {/* The placeholder is not inside the scramble's own element: an empty
          scramble must read as empty to anything that reads it, and "Your
          scramble appears…" there looked like one had been handed out. */}
      {scramble ? (
        <div className="flex min-h-7 flex-wrap items-center gap-x-3 gap-y-1.5 font-mono text-base leading-snug sm:text-lg">
          {scramble.split(" ").map((move, i) => (
            <span key={`${move}-${i}`}>{move}</span>
          ))}
        </div>
      ) : (
        <>
          {/* Empty, so it reads as "no scramble yet" to anything that looks. */}
          <div className="font-mono" aria-hidden="true" />
          <p className="flex min-h-7 items-center text-sm text-muted-dim">{placeholder}</p>
        </>
      )}
    </section>
  );
}

/** One card in the side panel. */
export function SideCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-5">
      <h2 className="text-base">{title}</h2>
      {children}
    </section>
  );
}

/** The key map, as a side card. Hidden on phones, where the move pad replaces it. */
export function KeyboardCard({ activeKey }: { activeKey: string | null }) {
  return (
    <div className="hidden md:block">
      <SideCard title="Keyboard controls">
        <KeyMapHint activeCode={activeKey} compact />
      </SideCard>
    </div>
  );
}

/** A small labelled number, for the side panel. */
export function Figure({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-xl bg-surface-hi px-3.5 py-3">
      <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-dim">{label}</span>
      <span className="tnum font-display text-2xl font-bold">{value}</span>
      {note ? <span className="text-[11px] text-muted-dim">{note}</span> : null}
    </div>
  );
}
