"use client";

import { useEffect, useState } from "react";

import {
  APPEARANCES,
  DEFAULT_APPEARANCE_ID,
  appearanceById,
  loadAppearanceId,
  saveAppearanceId,
  type CubeAppearance,
} from "@/lib/cubeAppearance";

/**
 * Choosing how the cube looks.
 *
 * Each option shows the actual six colours rather than a name, because a name
 * is not what somebody is choosing between — and because the two schemes that
 * matter are chosen by *matching* them to a cube in the person's hands, which
 * only works if the colours are on screen.
 *
 * ## The two kinds are separated on purpose
 *
 * Half of this list is decoration and half of it is not, and presenting them as
 * one undifferentiated row of skins would bury the half that changes what the
 * render means. Somebody with a Japanese-scheme cube who never finds that
 * option is being shown the wrong answer every time they verify a scramble;
 * somebody who cannot separate red from green and never finds the contrast
 * scheme has been left with a cube they cannot read.
 *
 * So the functional ones get their own group, a heading that says what they are
 * for, and they sit ABOVE the pretty ones.
 */
export function CubePicker() {
  const [selected, setSelected] = useState(DEFAULT_APPEARANCE_ID);

  // Read after mount: `localStorage` does not exist during the server render,
  // and reading it in the render body would make the two passes disagree.
  useEffect(() => {
    setSelected(loadAppearanceId());
  }, []);

  function choose(id: string) {
    setSelected(id);
    saveAppearanceId(id);
  }

  const decorative = APPEARANCES.filter((a) => !a.functional);
  const functional = APPEARANCES.filter((a) => a.functional);

  return (
    <div className="flex flex-col gap-8">
      <Group
        title="Match your cube"
        note="These change which colour sits on which face, so pick the one your own cube uses. It is what the scramble is checked against."
        appearances={functional}
        selected={selected}
        onChoose={choose}
      />
      <Group
        title="Finish"
        note="Purely how it looks. Every one is free, and always will be — a rating is a measure of solving, not something to spend."
        appearances={decorative}
        selected={selected}
        onChoose={choose}
      />
    </div>
  );
}

function Group({
  title,
  note,
  appearances,
  selected,
  onChoose,
}: {
  title: string;
  note: string;
  appearances: CubeAppearance[];
  selected: string;
  onChoose: (id: string) => void;
}) {
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="sr-only">{title}</legend>
      <div className="flex flex-col gap-1">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-dim">{title}</h3>
        <p className="max-w-md text-xs leading-relaxed text-muted-dim">{note}</p>
      </div>

      <div className="grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-2">
        {appearances.map((appearance) => (
          <Option
            key={appearance.id}
            appearance={appearance}
            checked={selected === appearance.id}
            onChoose={onChoose}
          />
        ))}
      </div>
    </fieldset>
  );
}

function Option({
  appearance,
  checked,
  onChoose,
}: {
  appearance: CubeAppearance;
  checked: boolean;
  onChoose: (id: string) => void;
}) {
  return (
    <label
      className={`flex cursor-pointer items-center gap-4 px-4 py-3.5 transition-colors ${
        checked ? "bg-surface-hi" : "bg-surface hover:bg-surface-hi"
      }`}
    >
      {/*
        A real radio, visually hidden rather than replaced by a div. Arrow keys
        move between options, the group is announced as a group, and the choice
        is reachable without a mouse — none of which is true of a styled div
        pretending to be a control.
      */}
      <input
        type="radio"
        name="cube-appearance"
        value={appearance.id}
        checked={checked}
        onChange={() => onChoose(appearance.id)}
        className="sr-only"
      />

      <Swatch appearance={appearance} />

      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="flex items-center gap-2 text-sm">
          {appearance.name}
          {checked ? (
            <span aria-hidden className="text-xs text-ready">
              ✓
            </span>
          ) : null}
        </span>
        <span className="text-xs leading-relaxed text-muted-dim">{appearance.note}</span>
      </span>
    </label>
  );
}

/**
 * The six colours, on the plastic they sit on.
 *
 * A flat grid rather than a rendered cube. A real cube at this size shows three
 * faces and hides three, which would mean the one thing somebody is trying to
 * check — *which six colours is this* — is exactly the thing a thumbnail cannot
 * show them.
 */
function Swatch({ appearance }: { appearance: CubeAppearance }) {
  const faces = Object.entries(appearance.faces);

  return (
    <span
      aria-hidden
      className="grid shrink-0 grid-cols-3 gap-[3px] rounded-md p-[3px]"
      style={{ background: appearance.finish.body }}
    >
      {faces.map(([face, colour]) => (
        <span
          key={face}
          className="h-3.5 w-3.5 rounded-[2px]"
          style={{ background: colour }}
        />
      ))}
    </span>
  );
}

/** The current appearance, for anything that wants to describe it in words. */
export function useAppearance(): CubeAppearance {
  const [id, setId] = useState(DEFAULT_APPEARANCE_ID);
  useEffect(() => {
    setId(loadAppearanceId());
  }, []);
  return appearanceById(id);
}
