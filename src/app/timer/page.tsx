import type { Metadata } from "next";

import { TimerScreen } from "@/components/TimerScreen";

export const metadata: Metadata = {
  title: "Timer — cubeduel",
  description: "A speedcubing timer with WCA scrambles and phase splits.",
};

export default function TimerPage() {
  return <TimerScreen />;
}
