import type { Metadata } from "next";
import Link from "next/link";

import { CubeLinkPanel } from "@/components/CubeLinkPanel";
import { SiteHeader } from "@/components/SiteHeader";

export const metadata: Metadata = {
  title: "Your cube",
  description:
    "Connect a Bluetooth speedcube and every timer, drill and case on the site takes its turns from the puzzle in your hands.",
};

/**
 * Where a physical cube becomes an input device.
 *
 * Separate from the timer on purpose. Connecting hardware is a thing you do
 * once, carefully, and want to *see working* before you trust a result to it —
 * and a connect button tucked into a corner of the timer gives you nowhere to
 * find out whether the link is good except by starting a solve and hoping.
 */
export default function CubePage() {
  return (
    <main className="flex min-h-dvh flex-col">
      <SiteHeader active="cube" />

      <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-10 px-6 pb-24 pt-8">
        <header className="flex flex-col gap-3">
          <h1 className="text-3xl leading-tight tracking-tight">Your cube</h1>
          <p className="max-w-xl text-sm leading-relaxed text-muted">
            Connect a Bluetooth speedcube and turn it. The cube here turns with
            it — and once it does, the timer, the drills and every case in{" "}
            <Link href="/learn" className="text-foreground underline underline-offset-4">
              the last layer
            </Link>{" "}
            take their moves from the puzzle in your hands instead of the keyboard.
          </p>
        </header>

        <CubeLinkPanel />

        <section className="flex flex-col gap-3 border-t border-border pt-8">
          <h2 className="text-[10px] uppercase tracking-widest text-muted-dim">
            What is honest about this
          </h2>
          <p className="max-w-xl text-xs leading-relaxed text-muted-dim">
            The Bluetooth path is written against cubing.js&rsquo;s shared smart-cube
            interface and every layer above it is tested — connecting, calibrating,
            mirroring, losing the cube mid-session. What has{" "}
            <span className="text-muted">not</span> happened is a run against real
            hardware: no GAN, GoCube or GiiKER has ever been held up to it. Treat
            it as unproven on your particular cube until you have seen it turn,
            which is exactly what this page is for.
          </p>
          <p className="max-w-xl text-xs leading-relaxed text-muted-dim">
            Smart-cube solves are rated in their own pool, separately from
            keyboard ones. They are different sports at different time scales, and
            averaging them together would make both numbers mean nothing.
          </p>
        </section>
      </div>
    </main>
  );
}
