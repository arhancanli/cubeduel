import type { Metadata } from "next";

import { TrainScreen } from "@/components/TrainScreen";

export const metadata: Metadata = {
  title: "Train",
  description:
    "Drill the OLL and PLL cases your own solves show are costing you time. Scheduled by how fast you actually are, not by a self-reported guess.",
};

export default function TrainPage() {
  return <TrainScreen />;
}
