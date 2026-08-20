import type { MetadataRoute } from "next";

import { SITE_URL } from "@/lib/site";

/**
 * Only pages worth landing on cold.
 *
 * `/settings` and the per-player profiles are left out deliberately: settings is
 * useless without an account, and profiles are created by people rather than by
 * us — listing them would publish a directory of users nobody asked to be in.
 *
 * `/verify`, `/reset` and `/forgot` are left out for a sharper reason. The first
 * two carry a single-use token in the URL, so a crawler that fetched one would
 * SPEND it — and then publish the page it landed on. All three also set
 * `robots: noindex` on the page itself, because a sitemap omission only means a
 * crawler was not invited, not that it will stay away.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    { url: SITE_URL, lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: `${SITE_URL}/play`, lastModified: now, changeFrequency: "monthly", priority: 0.9 },
    { url: `${SITE_URL}/daily`, lastModified: now, changeFrequency: "daily", priority: 0.9 },
    { url: `${SITE_URL}/ranked`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    { url: `${SITE_URL}/duel`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    { url: `${SITE_URL}/train`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE_URL}/timer`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE_URL}/leaderboard`, lastModified: now, changeFrequency: "hourly", priority: 0.6 },
    { url: `${SITE_URL}/progress`, lastModified: now, changeFrequency: "monthly", priority: 0.5 },
    { url: `${SITE_URL}/privacy`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
  ];
}
