import type { Metadata } from "next";

import { LandingScreen } from "@/components/LandingScreen";
import dailies from "@/data/dailies.json";

export const metadata: Metadata = {
  // Absolute, not templated: this is the root and appending "· cubeduel" to a
  // title that already begins with it reads as a stutter in a browser tab.
  title: {
    absolute: "cubeduel — the speedcubing site that shows you why you’re slow",
  },
  description:
    "Free speedcubing timer and trainer. Every solve reviewed move by move — your cross against the shortest possible, where you paused, which OLL and PLL to learn next. Race friends live and climb a verified ranked ladder. No account needed.",
};

export default function Home() {
  // Only the start date crosses to the client — the scramble list stays here.
  return <LandingScreen dailyStart={dailies.start} />;
}
