import type { Metadata } from "next";

import { ResetScreen } from "@/components/ResetScreen";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Set a new password · cubeduel",
  // Never indexed. These URLs carry a single-use token, and a search engine
  // that crawled one would spend it — and then publish the page it landed on.
  robots: { index: false, follow: false },
};

export default async function ResetPage(props: PageProps<"/reset">) {
  const params = await props.searchParams;
  const token = typeof params.token === "string" ? params.token : null;
  return <ResetScreen token={token} />;
}
