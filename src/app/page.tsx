import type { Metadata } from "next";

import { LandingScreen } from "@/components/LandingScreen";
import dailies from "@/data/dailies.json";
import { SITE_URL } from "@/lib/site";

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
  // What the site is, for search engines: its name, and that it is a free web
  // app. Everything in it is a constant.
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "cubeduel",
    url: SITE_URL,
    description: "Free speedcubing timer and trainer that reviews every solve move by move.",
  };
  // Only the start date crosses to the client — the scramble list stays here.
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
      />
      <LandingScreen dailyStart={dailies.start} />
    </>
  );
}
