import type { MetadataRoute } from "next";

import { qditUrl } from "@/lib/api/resources";

/**
 * The public, account-free pages. Published milestone proofs (/p/…) are
 * reachable through the links teams share and are left out: listing them
 * would mean reading every published project here on each crawl.
 */
const PAGES: Array<{ path: string; priority: number }> = [
  { path: "/", priority: 1 },
  { path: "/verify", priority: 0.8 },
  { path: "/user-guide", priority: 0.7 },
  { path: "/docs", priority: 0.6 },
  { path: "/login", priority: 0.3 },
];

export default function sitemap(): MetadataRoute.Sitemap {
  return PAGES.map(({ path, priority }) => ({
    url: qditUrl(path),
    changeFrequency: "weekly",
    priority,
  }));
}
