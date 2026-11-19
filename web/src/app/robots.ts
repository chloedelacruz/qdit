import type { MetadataRoute } from "next";

import { qditUrl } from "@/lib/api/resources";

/**
 * Crawlers get the public pages: the landing page, the user guide, the docs,
 * /verify and published milestone proofs under /p. Everything in the `(app)`
 * group sits behind sign-in and redirects a crawler to /login, so it is listed
 * here only to save the crawl; the auth check is still the boundary.
 */
const SIGNED_IN = [
  "/dashboard",
  "/deployments",
  "/hackathons",
  "/milestones",
  "/projects",
  "/proofs",
  "/settings",
  "/tasks",
  "/wallet",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/auth/", "/oauth/", ...SIGNED_IN],
    },
    sitemap: qditUrl("/sitemap.xml"),
  };
}
