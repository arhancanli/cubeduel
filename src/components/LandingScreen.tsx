"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";

import { SolverDemo } from "@/components/SolverDemo";
import { Reveal } from "@/components/Reveal";
import { SiteHeader } from "@/components/SiteHeader";
import { StreakCard } from "@/components/StreakCard";
import { CubeNet } from "@/components/CubeNet";
import { Glyph } from "@/components/Glyph";
import { HomeDashboard } from "@/components/HomeDashboard";
import { TodayStrip } from "@/components/TodayStrip";
import { formatAverage, formatMs } from "@/lib/format";
import { ao5, bestSingle } from "@/lib/stats";
import { loadHistory, type StoredSolve } from "@/lib/solveHistory";
import { faceFor, stickerVar, type FaceKey } from "@/lib/modes";
import { useSession } from "@/lib/useSession";

/**
 * The front door.
 *
 * Two rules govern it, and they survived the platform being added on top.
 *
 * **Nothing here asks anyone to sign up before solving.** Chess.com's landing
 * page works because "Play" starts a game, not a registration form. Ranked needs
 * an account because a rating has to belong to someone, but it is the *second*
 * button, never the first — the account earns itself once there is something
 * worth keeping.
 *
 * **Anyone who has already solved here should not be sold to again.** If there is
 * local history the page leads with "Continue" and the pitch moves out of the way.
 */

export function LandingScreen({ dailyStart }: { dailyStart: string }) {
  const [history, setHistory] = useState<StoredSolve[] | null>(null);

  useEffect(() => {
    setHistory(loadHistory());
  }, []);

  const returning = (history?.length ?? 0) > 0;
  const { loaded, session } = useSession();

  // A player gets their home, not the pitch. Decided after the session loads, so
  // the static page a visitor (or a crawler) receives is always the pitch.
  if (loaded && session.signedIn) {
    return (
      <main className="flex min-h-dvh flex-col">
        <SiteHeader active="home" />
        <HomeDashboard handle={session.handle} dailyStart={dailyStart} />
      </main>
    );
  }

  return (
    <main className="flex min-h-dvh flex-col">
      <SiteHeader active="home" />

      {/* Hero: the claim on the left, the six modes on the right as a cube net. */}
      <section className="mx-auto grid w-full max-w-6xl items-center gap-10 px-4 pb-14 pt-6 sm:px-8 sm:pt-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,34rem)] lg:gap-14 lg:pt-20">
        <Reveal className="flex flex-col gap-6">
          <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-sticker-green">
            {returning ? "Welcome back" : "Free · open source · no account needed"}
          </p>
          <h1 className="text-balance text-[2.5rem] leading-[1.03] sm:text-5xl xl:text-6xl">
            The speedcubing site that shows you why you&rsquo;re slow.
          </h1>
          <p className="max-w-xl text-pretty text-base leading-relaxed text-muted sm:text-lg">
            Time your solves, race friends live, climb a ladder where every time is
            verified — and get every solve reviewed move by move: your cross against
            the shortest possible, where you stopped, which cases to learn next.
          </p>

          <div className="flex flex-wrap items-center gap-3">
            <Link href="/timer" className="btn-go px-7 py-3.5 text-base">
              {returning ? "Continue solving" : "Start solving"}
            </Link>
            <Link href="/race" className="btn-secondary px-6 py-3.5 text-base">
              Race a friend
            </Link>
          </div>

          {returning && history ? (
            <>
              <ReturningStats history={history} />
              <StreakCard compact />
            </>
          ) : (
            <p className="text-sm text-muted-dim">Solving needs no account. Free, and it works offline.</p>
          )}

          {/* The other half of the audience: every call to action above assumes
              you can already solve a cube. One quiet line rather than a third
              button, because two competing buttons already argue. */}
          <Link
            href="/solve"
            className="self-start text-sm text-muted underline decoration-border underline-offset-4 transition-colors hover:text-foreground hover:decoration-current"
          >
            Can&rsquo;t solve one yet? Start here.
          </Link>
        </Reveal>

        <Reveal delayMs={140}>
          <CubeNet />
        </Reveal>
      </section>

      <section className="mx-auto w-full max-w-6xl px-4 pb-20 sm:px-8">
        <TodayStrip dailyStart={dailyStart} />
      </section>

      {/* A cube that solves itself. The scramble is WCA random-state, the
          solution comes from the solver in this repository, and the two numbers
          underneath were measured when it was generated. It is the one claim on
          this page a visitor can check. */}
      <section className="border-t border-border">
        <div className="mx-auto flex w-full max-w-3xl flex-col items-center gap-6 px-6 pt-24 text-center">
          <Reveal className="flex flex-col items-center gap-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-dim">The engine</p>
            <h2 className="text-balance text-3xl sm:text-4xl">It solves any cube in about 19 moves.</h2>
          </Reveal>
        </div>
        <Reveal delayMs={120} className="w-full px-6 pb-8">
          <SolverDemo />
        </Reveal>
      </section>

      {/* What it does, shown rather than argued. The first version explained
          itself in eight essays and a scroll animation five screens long; this
          is four things, each with the product itself as the picture. */}
      <section className="border-t border-border">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-20 px-4 py-24 sm:px-8">
          <Feature
            eyebrow="Solve review"
            title="Every solve, read back turn by turn."
            body="Your cross against the shortest one on the same face, with the route written out. Where you stopped, and for how long. Turns you undid. Cases you did in two looks, with the algorithm to learn. Choose any moment and the replay plays it."
            image={{ src: "/tour/review.webp", width: 1192, height: 1100, alt: "A solve review: the replay cube beside three moments — a three-move cross credited as optimal, a turn undone, and a two-second pause before the third pair." }}
            href="/play"
            action="Solve one and review it"
          />
          <Feature
            eyebrow="Insights"
            title="The habit costing you the most."
            body="Across your last 25 solves, habits are ranked by how much time each one costs you — so you know what to practise tomorrow. It won't claim anything from fewer than five solves."
            image={{ src: "/tour/insights.webp", width: 1192, height: 725, alt: "Insights across six solves: fix this first — you stop before F2L 3, about two seconds a solve." }}
            href="/review"
            action="See your insights"
            flip
          />
          <div className="grid gap-4 md:grid-cols-3">
            <ModeCard
              face="race"
              title="Race a friend, live"
              body="Send a link. A shared countdown, then the same scramble on both screens — and you watch each other get through the cross, the pairs and the last layer."
              href="/race"
            />
            <ModeCard
              face="ranked"
              title="A rating that means something"
              body="The server issues the scramble and replays your moves. If the cube doesn't end solved, the time doesn't exist. Your rating reads back as an average."
              href="/ranked"
            />
            <ModeCard
              face="daily"
              title="One scramble a day"
              body="The same cube for everyone, one attempt, and a streak for the days in a row you solve."
              href="/daily"
            />
          </div>
        </div>
      </section>

      <section className="border-t border-border">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-24 sm:px-8">
          <div className="flex flex-col gap-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-dim">Everything else</p>
            <h2 className="text-balance text-3xl sm:text-4xl">Whatever stage you&rsquo;re at.</h2>
          </div>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {EVERYTHING.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="group flex h-full flex-col gap-1.5 rounded-2xl border border-border bg-surface p-5 transition-colors hover:border-muted-dim/60"
                >
                  <span className="font-semibold">
                    {item.title}{" "}
                    <span aria-hidden="true" className="inline-block text-muted-dim transition-transform group-hover:translate-x-0.5">→</span>
                  </span>
                  <span className="text-sm leading-relaxed text-muted">{item.body}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <footer className="border-t border-border">
        <div className="mx-auto flex w-full max-w-3xl flex-col items-center gap-6 px-6 py-24 text-center">
          <Reveal className="flex flex-col items-center gap-5">
            <h2 className="text-balance text-2xl tracking-tight sm:text-3xl">
              Start with one solve.
            </h2>
            <Link
              href="/timer"
              className="btn-go px-7 py-3.5 text-sm"
            >
              {returning ? "Continue solving" : "Start solving"}
            </Link>
            <p className="text-xs text-muted-dim">
              WCA-legal random-state scrambles. Works offline. No account needed to solve.
            </p>
            {/* The one reason not to switch is the history left behind. */}
            <Link
              href="/progress"
              className="text-sm text-foreground underline-offset-4 hover:underline"
            >
              Already on csTimer? Bring your history →
            </Link>
          </Reveal>

          {/* The only place privacy is linked from. A disclosure nobody can
              reach is not a disclosure, and the footer is where people look. */}
          <nav className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs text-muted-dim">
            <Link
              href="/privacy"
              className="underline underline-offset-4 transition-colors hover:text-foreground"
            >
              Privacy
            </Link>
            <a
              href="https://github.com/arhancanli/cubeduel"
              className="underline underline-offset-4 transition-colors hover:text-foreground"
            >
              Source
            </a>
            <Link
              href="/leaderboard"
              className="underline underline-offset-4 transition-colors hover:text-foreground"
            >
              Leaderboard
            </Link>
          </nav>
        </div>
      </footer>
    </main>
  );
}


/**
 * What somebody who has solved here already wants to see first: where they are.
 * Read from this device's history, so it works signed out and offline.
 */
function ReturningStats({ history }: { history: StoredSolve[] }) {
  const timed = history.map((solve) => ({ ms: solve.durationMs, penalty: solve.penalty }));
  const best = bestSingle(timed);
  const stats = [
    { label: "Solves", value: history.length.toLocaleString("en") },
    { label: "Best single", value: best === null ? "—" : formatMs(best, { truncate: false }) },
    { label: "Last ao5", value: formatAverage(ao5(timed)) },
  ];
  return (
    <dl className="grid max-w-md grid-cols-3 gap-2">
      {stats.map((stat) => (
        <div key={stat.label} className="rounded-xl border border-border bg-surface px-3.5 py-3">
          <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-dim">{stat.label}</dt>
          <dd className="tnum mt-1 font-display text-xl font-bold">{stat.value}</dd>
        </div>
      ))}
    </dl>
  );
}

const EVERYTHING = [
  { href: "/solve", title: "Learn to solve", body: "Seven steps from never having solved one, each algorithm on a cube you can turn." },
  { href: "/solver", title: "Cube solver", body: "Stuck? Enter your cube's colours and get it solved in about 19 moves." },
  { href: "/learn", title: "All 78 algorithms", body: "Every OLL and PLL case, grouped by what you see on top, each checked against the puzzle." },
  { href: "/train", title: "Drill your cases", body: "The cases you're slow on come back sooner, until each one is mastered." },
  { href: "/rush", title: "Rush", body: "Beat a target built from your own pace. It tightens every time you do. Three misses ends it." },
  { href: "/clubs", title: "Clubs", body: "A board for your school or your friends, ranked by the same verified solves." },
  { href: "/progress", title: "Bring your csTimer history", body: "Import your export and your progress starts from where you are, not from zero." },
];

function Feature({
  eyebrow,
  title,
  body,
  image,
  href,
  action,
  flip = false,
}: {
  eyebrow: string;
  title: string;
  body: string;
  image: { src: string; width: number; height: number; alt: string };
  href: string;
  action: string;
  flip?: boolean;
}) {
  return (
    <div className="grid items-center gap-8 lg:grid-cols-2 lg:gap-14">
      <Reveal className={`flex flex-col gap-4 ${flip ? "lg:order-2" : ""}`}>
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-sticker-green">{eyebrow}</p>
        <h2 className="text-balance text-3xl sm:text-4xl">{title}</h2>
        <p className="max-w-lg text-base leading-relaxed text-muted">{body}</p>
        <Link href={href} className="btn-go mt-2 self-start px-5 py-3 text-sm">
          {action}
        </Link>
      </Reveal>
      <Reveal delayMs={120} className={flip ? "lg:order-1" : ""}>
        <Image
          src={image.src}
          width={image.width}
          height={image.height}
          alt={image.alt}
          sizes="(min-width: 1024px) 560px, 100vw"
          className="h-auto w-full rounded-2xl border border-border shadow-[var(--elevation-2)]"
        />
      </Reveal>
    </div>
  );
}

function ModeCard({ face, title, body, href }: { face: FaceKey; title: string; body: string; href: string }) {
  const mode = faceFor(face);
  return (
    <Link
      href={href}
      style={{ "--face": stickerVar(mode.sticker) } as React.CSSProperties}
      className="group flex flex-col gap-3 rounded-2xl border border-border bg-surface p-6 transition-colors hover:border-[var(--face)]"
    >
      <Glyph pattern={mode.glyph} sticker={mode.sticker} size={28} />
      <h3 className="text-xl">{title}</h3>
      <p className="text-sm leading-relaxed text-muted">{body}</p>
      <span className="mt-auto pt-1 text-sm font-semibold">
        {mode.label} <span aria-hidden="true" className="inline-block transition-transform group-hover:translate-x-0.5">→</span>
      </span>
    </Link>
  );
}
