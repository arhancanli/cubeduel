/**
 * Where this deployment lives.
 *
 * Metadata needs an absolute origin — a relative Open Graph image is ignored by
 * every scraper — and hardcoding one means preview deployments advertise the
 * production URL. Vercel supplies the deployment's own host, so previews
 * describe themselves and production describes production.
 */
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL
  ? process.env.NEXT_PUBLIC_SITE_URL
  : process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:3000";
