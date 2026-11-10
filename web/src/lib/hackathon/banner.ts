import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createServiceClient, serviceSecretKey } from "@/lib/hackathon/service-client";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/types/database";
import type { HackathonBannerData } from "./banner-state";

/**
 * The next hackathon that has not closed yet, for the site-wide banner.
 *
 * Only public facts (slug, name, window) are read. A failure returns null:
 * the banner is a promotion, and nothing about it may break the page.
 */
async function nextOpenHackathon(client: SupabaseClient<Database>): Promise<HackathonBannerData | null> {
  try {
    const { data, error } = await client
      .from("hackathons")
      .select("slug, name, opens_at, closes_at")
      .gt("closes_at", new Date().toISOString())
      .order("opens_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error || !data) return null;
    return { slug: data.slug, name: data.name, opensAt: data.opens_at, closesAt: data.closes_at };
  } catch {
    return null;
  }
}

/** For the signed-in app shell: RLS lets any signed-in user read `hackathons`. */
export async function loadAppHackathonBanner(): Promise<HackathonBannerData | null> {
  return nextOpenHackathon(await createClient());
}

/**
 * For the public landing page, where the visitor is signed out and RLS hides
 * `hackathons`. Reads the same three public columns with the service role;
 * no key, no banner.
 */
export async function loadPublicHackathonBanner(): Promise<HackathonBannerData | null> {
  const secret = serviceSecretKey();
  if (!secret) return null;
  return nextOpenHackathon(createServiceClient(secret));
}
