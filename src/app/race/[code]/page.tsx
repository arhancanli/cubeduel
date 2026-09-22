import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { RaceScreen } from "@/components/RaceScreen";
import { isRaceCode } from "@/lib/race";
import { SITE_URL } from "@/lib/site";
import { ensureProfile } from "@/lib/server/profiles";
import { isDatabaseConfigured } from "@/lib/server/supabase";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Race · cubeduel",
  description: "A live speedcubing race between two people.",
  // A one-off link between two people, over in minutes.
  robots: { index: false, follow: false },
};

export default async function RaceCodePage(props: PageProps<"/race/[code]">) {
  const { code } = await props.params;
  if (!isRaceCode(code) || !isDatabaseConfigured()) notFound();
  const profile = await ensureProfile().catch(() => null);
  return <RaceScreen code={code} signedIn={Boolean(profile)} siteUrl={SITE_URL} />;
}
