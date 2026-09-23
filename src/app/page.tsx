import type { Metadata } from "next";

import { LandingScreen } from "@/components/LandingScreen";
import dailies from "@/data/dailies.json";

export const metadata: Metadata = {
  // Absolute, not templated: this is the root and appending "· cubeduel" to a
  // title that already begins with it reads as a stutter in a browser tab.
  title: {
    absolute: "cubeduel — a rating that actually means something",
  },
  description:
    "Speedcubing with a real ladder. The server hands you a scramble nobody has seen and replays your solve to prove it happened. Every solve is split into cross, F2L, OLL and PLL, so you practise the part that is actually slow. No account needed to solve.",
};

export default function Home() {
  // Only the start date crosses to the client — the scramble list stays here.
  return <LandingScreen dailyStart={dailies.start} />;
}
