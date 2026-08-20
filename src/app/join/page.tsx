import type { Metadata } from "next";

import { ClaimScreen } from "@/components/ClaimScreen";

/**
 * Signing up.
 *
 * `force-dynamic` because a DB-gated page will otherwise prerender as static
 * and bake in whatever state the build machine saw — which is exactly how
 * `/ranked` once shipped a permanent "not configured" gate.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Keep your solves · cubeduel",
  description:
    "Your solve history lives in this browser. An account carries it between devices and is what a rating belongs to.",
};

export default function JoinPage() {
  return <ClaimScreen />;
}
