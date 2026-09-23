import { SiteHeader } from "@/components/SiteHeader";

/**
 * What a page shows while the server is still fetching it — the ladder, a
 * profile, a club board. Without it a click on a database-backed page looked
 * like nothing happened for a second, and people click again.
 *
 * The navigation stays, so the page does not jump; the body is the shape of a
 * page arriving, not a spinner with nothing around it.
 */
export default function Loading() {
  return (
    <main className="flex min-h-dvh flex-col" aria-busy="true">
      <SiteHeader active="home" />
      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 pb-24 pt-6 sm:px-8 lg:pt-12">
        <span className="sr-only">Loading</span>
        <div className="h-4 w-24 animate-pulse rounded bg-surface-hi" />
        <div className="h-12 w-2/3 max-w-md animate-pulse rounded-xl bg-surface" />
        <div className="h-5 w-full max-w-xl animate-pulse rounded bg-surface" />
        <div className="grid gap-3 pt-4 sm:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-32 animate-pulse rounded-2xl border border-border bg-surface" />
          ))}
        </div>
      </div>
    </main>
  );
}
