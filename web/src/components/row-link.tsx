"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * The overlay link on a linked row — suppressed when it points at the page the
 * row is already on.
 *
 * Cross-project lists and project-scoped lists share one row component, so the
 * same `MilestoneListRow` links to `/projects/[slug]/milestones` from the
 * dashboard (useful) and from `/projects/[slug]/milestones` itself (a link to
 * the page you are reading). The second case is not inert: it is a real
 * navigation, so Next renders `projects/[slug]/loading.tsx`, fetches the route
 * again and paints the identical page — a skeleton flash and nothing else.
 *
 * It is invisible until something invalidates the client Router Cache. A write
 * action calls `revalidatePath("/", "layout")`, so the first same-page click
 * after approving a milestone can no longer be served from cache and makes the
 * round trip visible. That is why the report is always "after approving".
 *
 * Dropping the anchor is the fix rather than intercepting the click: with no
 * link there is no pointer cursor and no focusable stop promising a
 * destination that does not exist.
 */
export function RowLink({ href, label }: { href: string; label: string }) {
  const pathname = usePathname();
  if (pathname === href) return null;

  return <Link href={href} aria-label={label} className="focus-ring absolute inset-0" />;
}
