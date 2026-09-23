import { Glyph } from "@/components/Glyph";
import { faceFor, stickerVar, type FaceKey } from "@/lib/modes";

/**
 * The top of a page that is read rather than solved on.
 *
 * One pattern so every such page opens the same way: what it is in small type,
 * the title large, one paragraph saying what happens here. A mode page carries
 * its face — the glyph and the colour it has on the home page's net — so the
 * colour is a place, not a decoration.
 */
export function PageHero({
  title,
  eyebrow,
  face,
  children,
  center = false,
}: {
  title: React.ReactNode;
  eyebrow?: string;
  face?: FaceKey;
  children?: React.ReactNode;
  center?: boolean;
}) {
  const mode = face ? faceFor(face) : null;
  return (
    <header className={`flex flex-col gap-4 ${center ? "items-center text-center" : ""}`}>
      {mode || eyebrow ? (
        <p className="flex items-center gap-2.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-dim">
          {mode ? <Glyph pattern={mode.glyph} sticker={mode.sticker} size={18} /> : null}
          <span style={mode ? { color: stickerVar(mode.sticker) } : undefined}>{eyebrow ?? mode?.label}</span>
        </p>
      ) : null}
      <h1 className="text-balance text-4xl leading-[1.05] sm:text-5xl">{title}</h1>
      {children ? (
        <div className={`max-w-2xl text-pretty text-base leading-relaxed text-muted ${center ? "mx-auto" : ""}`}>
          {children}
        </div>
      ) : null}
    </header>
  );
}
