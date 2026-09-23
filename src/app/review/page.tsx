import type { Metadata } from "next";
import { Suspense } from "react";

import { ReviewScreen } from "@/components/ReviewScreen";

export const metadata: Metadata = {
  title: "Solve review",
  description:
    "Every solve read back one turn at a time: the shortest cross you could have built, the pauses, the turns undone, and the cases worth learning.",
  // It reads this browser's own solves, so there is nothing for a crawler here.
  robots: { index: false },
};

export default function ReviewPage() {
  // Suspense because the screen reads the query string, which a static page
  // only has in the browser.
  return (
    <Suspense>
      <ReviewScreen />
    </Suspense>
  );
}
