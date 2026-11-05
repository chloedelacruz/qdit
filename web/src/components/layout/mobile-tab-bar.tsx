"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { ICON } from "@/lib/icons";
import { cn } from "@/lib/utils";
import { isActive, mobileTabs } from "./nav-items";

/**
 * Bottom navigation for a phone (QDIT-34).
 *
 * It replaces the hamburger, which cost an extra tap before every destination.
 * Four tabs follow the scope the person is in — the workspace, or the project
 * they are inside — and the fifth, More, opens a sheet with everything else.
 *
 * Every tab is an icon *and* a word: a tab bar is primary navigation, and an
 * icon-only one is where discoverability goes to die. Hidden from `lg` up,
 * where the sidebar takes over; the two are never on screen together.
 */
export function MobileTabBar({
  slug,
  moreOpen,
  onMore,
}: {
  slug: string | undefined;
  moreOpen: boolean;
  onMore: () => void;
}) {
  const pathname = usePathname();
  const tabs = mobileTabs(slug);

  return (
    <nav
      aria-label="Tabs"
      className={cn(
        "bg-sidebar fixed inset-x-0 bottom-0 z-40 border-t lg:hidden",
        "pb-[env(safe-area-inset-bottom)]",
      )}
    >
      <ul className="grid grid-cols-5">
        {tabs.map((tab) => {
          const active = isActive(pathname, tab);
          const Icon = tab.icon;

          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "focus-ring transition-qdit flex h-14 flex-col items-center justify-center gap-1 text-[0.6875rem] font-medium",
                  "touch-manipulation",
                  active ? "text-sidebar-primary" : "text-muted-foreground",
                )}
              >
                <Icon className="size-5" />
                {tab.label}
              </Link>
            </li>
          );
        })}

        <li>
          <button
            type="button"
            onClick={onMore}
            aria-expanded={moreOpen}
            aria-haspopup="dialog"
            className={cn(
              "focus-ring transition-qdit flex h-14 w-full flex-col items-center justify-center gap-1 text-[0.6875rem] font-medium",
              "touch-manipulation",
              moreOpen ? "text-sidebar-primary" : "text-muted-foreground",
            )}
          >
            <ICON.more className="size-5" />
            More
          </button>
        </li>
      </ul>
    </nav>
  );
}
