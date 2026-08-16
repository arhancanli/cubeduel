import type { Metadata } from "next";

import { LandingScreen } from "@/components/LandingScreen";

export const metadata: Metadata = {
  title: "cubeduel — find out where your solve actually goes",
  description:
    "A speedcubing timer that breaks every solve into cross, F2L, OLL and PLL, so you practise the part that's actually slow. WCA scrambles, a daily scramble, and keyboard cubing. No account needed.",
};

export default function Home() {
  return <LandingScreen />;
}
