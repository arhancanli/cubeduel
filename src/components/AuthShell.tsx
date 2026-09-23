import { Glyph, Mark } from "@/components/Glyph";
import { faceFor, type FaceKey } from "@/lib/modes";

const ACCOUNT_GETS: [FaceKey, string, string][] = [
  ["ranked", "A rating", "Server-verified solves, one number you can read back as seconds."],
  ["duel", "Opponents", "Duels, open challenges and live races against real people."],
  ["solve", "Your history, synced", "Solves from this device follow you to every other one."],
];

/**
 * The frame around every account form: what an account is for on the left,
 * the form in a card on the right. Beside the form rather than in front of it,
 * because solving never needed an account and the page should not pretend
 * otherwise. On a phone only the card shows.
 */
export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto grid w-full max-w-5xl flex-1 items-start gap-12 px-4 pb-24 pt-6 sm:px-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:pt-16">
      <aside className="hidden flex-col gap-8 pt-2 lg:flex">
        <Mark size={48} />
        <p className="font-display text-5xl font-extrabold leading-[1.05] tracking-tight">
          Your rating, your solves, every device.
        </p>
        <ul className="flex flex-col gap-5">
          {ACCOUNT_GETS.map(([face, title, body]) => {
            const mode = faceFor(face);
            return (
              <li key={title} className="flex gap-4">
                <Glyph pattern={mode.glyph} sticker={mode.sticker} size={28} />
                <span className="flex flex-col gap-0.5">
                  <span className="font-semibold">{title}</span>
                  <span className="text-sm leading-relaxed text-muted">{body}</span>
                </span>
              </li>
            );
          })}
        </ul>
      </aside>
      <div className="flex w-full flex-col gap-8 rounded-3xl border border-border bg-surface p-6 sm:p-8">
        {children}
      </div>
    </div>
  );
}
