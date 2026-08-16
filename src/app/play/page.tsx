import type { Metadata } from "next";

import { PlayScreen } from "@/components/PlayScreen";
import { parseScrambleParam } from "@/lib/scrambleParam";

export const metadata: Metadata = {
  title: "Play — cubeduel",
  description:
    "Cube with your keyboard or a Bluetooth smart cube. The clock starts on your first turn and stops the moment the cube is solved.",
};

/**
 * `?scramble=` hands a specific puzzle to a specific person — the challenge link.
 * It is validated in `parseScrambleParam` before going anywhere near the algorithm
 * parser; an invalid one is dropped and a fresh scramble is generated instead of
 * showing an error, since a mangled link should still land on a usable page.
 */
export default async function PlayPage({ searchParams }: PageProps<"/play">) {
  const params = await searchParams;
  return <PlayScreen initialScramble={parseScrambleParam(params.scramble)} />;
}
