import type { Metadata } from "next";

import { ProgressScreen } from "@/components/ProgressScreen";

export const metadata: Metadata = {
  title: "Progress",
  description: "Which phase of your solve is costing you the most, and why.",
};

export default function ProgressPage() {
  return <ProgressScreen />;
}
