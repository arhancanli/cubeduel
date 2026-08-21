/**
 * The virtual-cube keyboard layout.
 *
 * This mirrors cubing.js's built-in 3x3x3 mapping, which is the layout Twizzle and
 * cstimer already use — so anyone who has cubed on a keyboard before arrives
 * knowing it, and anyone who learns it here can use it elsewhere. Inventing our
 * own would be a worse product for no gain.
 *
 * The design is hand-shaped rather than mnemonic: the two hands alternate, and the
 * home-row keys drive the faces you turn most. `J`/`F` for U/U' sit under the index
 * fingers because U is the most-turned face on a 3x3.
 *
 * This table is for DISPLAY ONLY. cubing.js owns the real bindings; the app uses
 * this copy to highlight whichever key was pressed and for nothing else. So the
 * two can drift, and if they ever do the app teaches a beginner the wrong keys
 * with complete confidence — worse than showing no layout at all.
 *
 * `e2e/keymap.py` is what stops that. It reads the cube's actual pattern before
 * and after each key, then applies every candidate move to the "before" state to
 * see which one reproduces the "after" — so the move is identified by the puzzle
 * rather than by any table in this repository.
 *
 * This docblock previously claimed such a test existed. It did not. All 29
 * bindings turned out to be correct, but nothing here had ever checked.
 */

export interface KeyBinding {
  /** KeyboardEvent.code, which is layout-independent. */
  code: string;
  /** What is printed on the key. */
  label: string;
  move: string;
}

export interface KeyGroup {
  title: string;
  hint: string;
  bindings: KeyBinding[];
}

export const KEY_GROUPS: KeyGroup[] = [
  {
    title: "Faces",
    hint: "The six outer layers. These are most of every solve.",
    bindings: [
      { code: "KeyJ", label: "J", move: "U" },
      { code: "KeyF", label: "F", move: "U'" },
      { code: "KeyS", label: "S", move: "D" },
      { code: "KeyL", label: "L", move: "D'" },
      { code: "KeyI", label: "I", move: "R" },
      { code: "KeyK", label: "K", move: "R'" },
      { code: "KeyD", label: "D", move: "L" },
      { code: "KeyE", label: "E", move: "L'" },
      { code: "KeyH", label: "H", move: "F" },
      { code: "KeyG", label: "G", move: "F'" },
      { code: "KeyW", label: "W", move: "B" },
      { code: "KeyO", label: "O", move: "B'" },
    ],
  },
  {
    title: "Wide turns",
    hint: "Two layers at once — how most F2L pairs are actually inserted.",
    bindings: [
      { code: "KeyU", label: "U", move: "r" },
      { code: "KeyM", label: "M", move: "r'" },
      { code: "KeyC", label: "C", move: "l" },
      { code: "KeyR", label: "R", move: "l'" },
      { code: "KeyX", label: "X", move: "d" },
      { code: "Comma", label: ",", move: "d'" },
    ],
  },
  {
    title: "Slice",
    hint: "The middle layer. Central to roux and to most cross-colour swaps.",
    bindings: [
      { code: "KeyB", label: "B", move: "M" },
      { code: "KeyZ", label: "Z", move: "M'" },
      { code: "Period", label: ".", move: "M'" },
    ],
  },
  {
    title: "Rotations",
    hint: "Reorient the whole cube. Free before the clock starts, like inspection.",
    bindings: [
      { code: "Semicolon", label: ";", move: "y" },
      { code: "KeyA", label: "A", move: "y'" },
      { code: "KeyT", label: "T", move: "x" },
      { code: "KeyY", label: "Y", move: "x" },
      { code: "KeyV", label: "V", move: "x'" },
      { code: "KeyN", label: "N", move: "x'" },
      { code: "KeyP", label: "P", move: "z" },
      { code: "KeyQ", label: "Q", move: "z'" },
    ],
  },
];

/** Flat lookup for tests and for highlighting the key that was just pressed. */
export const BINDINGS_BY_CODE: ReadonlyMap<string, KeyBinding> = new Map(
  KEY_GROUPS.flatMap((g) => g.bindings).map((b) => [b.code, b]),
);
