import { stickerVar, type Sticker } from "@/lib/modes";

/**
 * A 3×3 sticker pictogram — the icon language of the whole site.
 *
 * Nine rounded squares, lit in one colour where the pattern says so. Drawn as SVG
 * rather than an icon font because it has to be exact at 12px in the sidebar and
 * at 40px on a tile, and because the unlit stickers must use the page's own line
 * colour to sit quietly on any surface.
 */
export function Glyph({
  pattern,
  sticker,
  size = 18,
  className = "",
}: {
  pattern: string;
  sticker: Sticker;
  size?: number;
  className?: string;
}) {
  const cells = pattern.padEnd(9, "0").slice(0, 9).split("");
  return (
    <svg
      viewBox="0 0 30 30"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      className={`shrink-0 ${className}`}
    >
      {cells.map((lit, i) => (
        <rect
          key={i}
          x={(i % 3) * 11}
          y={Math.floor(i / 3) * 11}
          width={8}
          height={8}
          rx={2}
          fill={lit === "1" ? stickerVar(sticker) : "var(--border)"}
        />
      ))}
    </svg>
  );
}

/**
 * The mark: four stickers from the corner of a cube, in the colours of the three
 * faces you can see at once plus the one behind them.
 */
export function Mark({ size = 24 }: { size?: number }) {
  const tiles: [number, number, Sticker][] = [
    [0, 0, "green"],
    [16, 0, "red"],
    [0, 16, "white"],
    [16, 16, "blue"],
  ];
  return (
    <svg viewBox="0 0 28 28" width={size} height={size} aria-hidden="true" focusable="false" className="shrink-0">
      {tiles.map(([x, y, s]) => (
        <rect key={`${x}-${y}`} x={x} y={y} width={12} height={12} rx={3} fill={stickerVar(s)} />
      ))}
    </svg>
  );
}
