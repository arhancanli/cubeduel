import type { MetadataRoute } from "next";

import { learnCases } from "@/lib/learn";
import { SITE_URL } from "@/lib/site";
import { INDEXABLE } from "@/lib/sitemapRoutes";

/**
 * Only pages worth landing on cold.
 *
 * The list itself lives in `sitemapRoutes.ts`, beside the reasons for everything
 * left out, so that `npm run audit` can check the two against the app's actual
 * routes. It had drifted badly: eighty-two pages existed that this file had
 * never heard of.
 *
 * The 78 last-layer cases are enumerated rather than listed by hand. They are a
 * fixed set that this repository defines, each one a page somebody might
 * genuinely search for — "OLL 27", "PLL T perm" — and typing them out would be
 * a second copy of a list that already exists.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();

  const pages: MetadataRoute.Sitemap = INDEXABLE.map((route) => ({
    url: route.path === "/" ? SITE_URL : `${SITE_URL}${route.path}`,
    lastModified: now,
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }));

  const cases = await learnCases();
  for (const c of cases) {
    pages.push({
      url: `${SITE_URL}/learn/${c.slug}`,
      lastModified: now,
      changeFrequency: "yearly",
      // A case page is worth finding but is not the front of the site, and the
      // algorithms on it will not change — they have not changed in decades.
      priority: 0.5,
    });
  }

  return pages;
}
