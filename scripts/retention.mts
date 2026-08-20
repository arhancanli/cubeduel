/**
 * The three numbers that decide whether this product works.
 *
 *   npm run retention [days]
 *
 * Nothing in this application could answer these until now, which means every
 * judgement about what to build has been made without them:
 *
 *   **Activation** — of the people who arrive, how many actually solve a cube?
 *   A visitor who never turns a face was never a user, however many of them
 *   there are.
 *
 *   **Run 2** — of the people who solve, how many come back for a second
 *   session? This is the one that matters most. A product people try once is a
 *   demo.
 *
 *   **Next day** — how many are here tomorrow? Everything else is a proxy for
 *   this.
 *
 * A report nobody reads is not a measurement, which is why this is a command
 * rather than a dashboard nobody deploys. It prints in one screen and says
 * plainly when there is not enough data to say anything — a rate computed from
 * four visitors is a number, not a finding.
 */
import { db } from "../src/lib/server/supabase";

const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOW_DAYS = Number(process.argv[2] ?? 30);

/**
 * Below this, a percentage is theatre.
 *
 * Twenty is not a statistical threshold, it is an honesty one: with fewer, one
 * person moves the figure by five points and reporting it to the nearest
 * percent implies a precision that is not there.
 */
const MIN_FOR_A_RATE = 20;

interface EventRow {
  visitor: string;
  session: string | null;
  name: string;
  at: string;
  props: Record<string, unknown> | null;
}

function rate(numerator: number, denominator: number): string {
  if (denominator < MIN_FOR_A_RATE) {
    return `— (only ${denominator}, too few to be a rate)`;
  }
  return `${((numerator / denominator) * 100).toFixed(1)}%  (${numerator}/${denominator})`;
}

function heading(text: string) {
  console.log(`\n${text}\n${"─".repeat(text.length)}`);
}

async function main() {
  const since = new Date(Date.now() - WINDOW_DAYS * DAY_MS).toISOString();

  // Paged, because a busy month exceeds PostgREST's default ceiling and a
  // silently truncated read would understate every rate below it.
  const rows: EventRow[] = [];
  const PAGE = 1000;
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await db()
      .from("events")
      .select("visitor, session, name, at, props")
      .gte("at", since)
      .order("at", { ascending: true })
      .range(offset, offset + PAGE - 1);

    if (error) throw new Error(`Could not read events: ${error.message}`);
    const page = (data ?? []) as unknown as EventRow[];
    rows.push(...page);
    if (page.length < PAGE) break;
  }

  console.log(`cubeduel — last ${WINDOW_DAYS} days`);
  console.log(`${rows.length} events`);

  if (rows.length === 0) {
    console.log(
      "\nNothing recorded yet. Either nobody has visited, or migration 0010 is\n" +
        "not applied, or the deployment predates the instrumentation. Check in\n" +
        "that order — the first is the likeliest and the least comfortable.",
    );
    return;
  }

  // ---------------------------------------------------------------------------
  // Per visitor, in time order.
  // ---------------------------------------------------------------------------

  const byVisitor = new Map<string, EventRow[]>();
  for (const row of rows) {
    const list = byVisitor.get(row.visitor);
    if (list) list.push(row);
    else byVisitor.set(row.visitor, [row]);
  }

  let activated = 0;
  let activatedAndReturned = 0;
  let nextDay = 0;
  let eligibleForNextDay = 0;

  for (const events of byVisitor.values()) {
    const sessions = new Set(events.map((e) => e.session).filter(Boolean));
    const solved = events.some((e) => e.name === "solve");
    const cameBack = sessions.size >= 2;

    if (solved) activated++;
    // Coming back without ever solving is not run 2 — it is a bounce that
    // happened twice.
    if (solved && cameBack) activatedAndReturned++;

    // Only visitors whose first day is old enough to have had a next day count
    // toward the next-day figure. Including somebody who arrived an hour ago
    // counts them as "did not return" and drags the number down every time it
    // is run — the classic way a retention figure lies downward.
    const firstAt = new Date(events[0].at).getTime();
    if (Date.now() - firstAt >= 2 * DAY_MS) {
      eligibleForNextDay++;
      const firstDay = Math.floor(firstAt / DAY_MS);
      if (events.some((e) => Math.floor(new Date(e.at).getTime() / DAY_MS) === firstDay + 1)) {
        nextDay++;
      }
    }
  }

  heading("The three that matter");
  console.log(`  visitors                ${byVisitor.size}`);
  console.log(`  activation (solved)     ${rate(activated, byVisitor.size)}`);
  console.log(`  run 2 (came back)       ${rate(activatedAndReturned, activated)}`);
  console.log(`  next day                ${rate(nextDay, eligibleForNextDay)}`);
  if (eligibleForNextDay < byVisitor.size) {
    console.log(
      `  (${byVisitor.size - eligibleForNextDay} visitor(s) too recent to have had a next day, excluded)`,
    );
  }

  // ---------------------------------------------------------------------------
  // The sign-up funnel.
  // ---------------------------------------------------------------------------

  const visitorsWith = (name: string) =>
    new Set(rows.filter((r) => r.name === name).map((r) => r.visitor)).size;

  const sawJoin = visitorsWith("join_view");
  const signedUp = visitorsWith("signup");
  const addedPasskey = visitorsWith("passkey_added");

  heading("Sign-up funnel");
  console.log(`  saw the claim screen    ${sawJoin}`);
  console.log(`  created an account      ${rate(signedUp, sawJoin)}`);
  console.log(`  added a passkey         ${rate(addedPasskey, signedUp)}`);

  // Whether the claim screen's whole argument works: does showing somebody
  // their own solves convert better than showing them a form?
  const joinViews = rows.filter((r) => r.name === "join_view");
  const withClaim = new Set(
    joinViews.filter((r) => r.props?.hasClaim === true).map((r) => r.visitor),
  );
  const withoutClaim = new Set(
    joinViews.filter((r) => r.props?.hasClaim === false).map((r) => r.visitor),
  );
  const signedUpSet = new Set(rows.filter((r) => r.name === "signup").map((r) => r.visitor));

  const converted = (set: Set<string>) =>
    [...set].filter((v) => signedUpSet.has(v)).length;

  heading("Does the claim actually help?");
  console.log(
    `  with solves to keep     ${rate(converted(withClaim), withClaim.size)}`,
  );
  console.log(
    `  with nothing to keep    ${rate(converted(withoutClaim), withoutClaim.size)}`,
  );
  console.log(
    "\n  The screen's entire argument is that showing somebody their own\n" +
      "  solves converts better than showing them a form. If these two are the\n" +
      "  same, the argument is wrong and the screen should be simpler.",
  );

  // ---------------------------------------------------------------------------
  // What people do.
  // ---------------------------------------------------------------------------

  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.name, (counts.get(row.name) ?? 0) + 1);

  heading("Events");
  for (const [name, count] of [...counts].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${name.padEnd(22)} ${count}`);
  }

  // ---------------------------------------------------------------------------
  // Daily, so a launch is visible.
  // ---------------------------------------------------------------------------

  const days = new Map<string, Set<string>>();
  for (const row of rows) {
    const day = row.at.slice(0, 10);
    const set = days.get(day) ?? new Set<string>();
    set.add(row.visitor);
    days.set(day, set);
  }

  heading("Visitors per day");
  const ordered = [...days].sort((a, b) => a[0].localeCompare(b[0])).slice(-14);
  const peak = Math.max(...ordered.map(([, set]) => set.size), 1);
  for (const [day, set] of ordered) {
    const bar = "█".repeat(Math.max(1, Math.round((set.size / peak) * 40)));
    console.log(`  ${day}  ${String(set.size).padStart(4)}  ${bar}`);
  }
}

main()
  .catch((error) => {
    console.error("\nFAILED:", error);
    process.exitCode = 1;
  })
  .finally(() => process.exit(process.exitCode ?? 0));
