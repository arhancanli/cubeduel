import type { MetadataRoute } from "next";

import { SITE_URL } from "@/lib/site";

/**
 * The API is disallowed not because it is secret — every write route already
 * refuses anonymous callers — but because crawling `/api/solve` would burn real
 * CPU on scrambles nobody asked about.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/settings"],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
