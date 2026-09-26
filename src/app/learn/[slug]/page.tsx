import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { CaseStudio } from "@/components/CaseStudio";
import { SiteHeader } from "@/components/SiteHeader";
import { learnCase, learnCases } from "@/lib/learn";

/**
 * One case, with a cube you can turn.
 *
 * Statically generated: there are 78 of them and they never change, so every
 * case page is a file rather than a database round trip.
 */
export async function generateStaticParams() {
  return (await learnCases()).map((c) => ({ slug: c.slug }));
}

export async function generateMetadata(
  props: PageProps<"/learn/[slug]">,
): Promise<Metadata> {
  const { slug } = await props.params;
  const study = await learnCase(slug);
  if (!study) return { title: "Case not found" };

  const title = study.name && study.name !== study.label ? `${study.label} · ${study.name}` : study.label;
  return {
    title,
    description: `${study.alg} — ${study.moveCount} moves. Watch it run on the cube, then try it yourself.`,
  };
}

export default async function CasePage(props: PageProps<"/learn/[slug]">) {
  const { slug } = await props.params;
  const study = await learnCase(slug);
  if (!study) notFound();

  // Neighbours within the same group, so paging through is paging through cases
  // that look alike — which is the only ordering worth having when the whole
  // difficulty is telling them apart.
  const all = await learnCases();
  const group = all.filter(
    (c) => c.stage === study.stage && (study.stage === "PLL" || c.shape === study.shape),
  );
  const index = group.findIndex((c) => c.slug === study.slug);
  const previous = index > 0 ? group[index - 1] : null;
  const next = index >= 0 && index < group.length - 1 ? group[index + 1] : null;

  return (
    <main className="flex min-h-dvh flex-col">
      <SiteHeader active="learn" />

      <div className="page-frame flex w-full max-w-4xl flex-1 flex-col gap-8 px-4 pb-24 pt-6 sm:px-8 lg:pt-12">
        <header className="flex flex-col gap-2">
          <Link
            href="/learn"
            className="self-start text-xs text-muted-dim transition-colors hover:text-foreground"
          >
            ← Every case
          </Link>

          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <h1 className="text-3xl tracking-tight">{study.label}</h1>
            {study.name && study.name !== study.label.split(" ")[1] ? (
              <span className="text-lg text-muted">{study.name}</span>
            ) : null}
          </div>

          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-dim">
            {study.shape ? <span>{study.shape}</span> : null}
            {study.shape ? <span aria-hidden="true">·</span> : null}
            <span>{study.moveCount} moves</span>
          </p>
        </header>

        <CaseStudio
          study={study}
          previous={previous ? { slug: previous.slug, label: previous.label } : null}
          next={next ? { slug: next.slug, label: next.label } : null}
          siblings={group
            .filter((c) => c.slug !== study.slug)
            .map((c) => ({ slug: c.slug, label: c.label, setup: c.setup }))}
        />
      </div>
    </main>
  );
}
