"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, useState } from "react";

import { QditLogo } from "@/components/brand/qdit-mark";
import { ThemeToggle } from "@/components/theme-toggle";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import type { NotificationRow } from "@/lib/queries";
import { NotificationBell } from "./notification-bell";
import { MobileTabBar } from "./mobile-tab-bar";
import { NavigationProgress } from "./navigation-progress";
import { FOOTER_NAV, HELP_NAV, WORKSPACE_NAV, projectNav } from "./nav-items";
import { ProjectSwitcher, type ProjectOption } from "./project-switcher";
import { SidebarNav } from "./sidebar-nav";
import { UserMenu } from "./user-menu";
import { ICON } from "@/lib/icons";

/** The project slug the current route is scoped to, if any. */
function useActiveSlug(): string | undefined {
  const pathname = usePathname();
  // `/projects` (the index) has no slug; `/projects/atlas-escrow/board` does.
  return pathname.match(/^\/projects\/([^/]+)/)?.[1];
}

function SidebarBody({
  projects,
  onNavigate,
  withHelp = false,
}: {
  projects: ProjectOption[];
  onNavigate?: () => void;
  /** The More sheet carries help too; on a desktop it is in the account menu. */
  withHelp?: boolean;
}) {
  const activeSlug = useActiveSlug();

  return (
    <div className="flex h-full flex-col gap-1 px-3 pb-4">
      <div className="pb-1">
        <ProjectSwitcher
          projects={projects}
          activeSlug={activeSlug}
          onNavigate={onNavigate}
        />
      </div>

      {/* Only rendered inside a project, so the nav never offers a scoped
          destination without a scope to apply it to. */}
      {activeSlug ? (
        <>
          <SidebarNav items={projectNav(activeSlug)} onNavigate={onNavigate} />
          <Separator className="my-3" />
        </>
      ) : null}

      <SidebarNav items={WORKSPACE_NAV} label="Workspace" onNavigate={onNavigate} />

      <div className="mt-auto pt-4">
        <SidebarNav items={FOOTER_NAV} label={withHelp ? "You" : undefined} onNavigate={onNavigate} />
        {withHelp ? (
          <SidebarNav items={HELP_NAV} label="Help" onNavigate={onNavigate} />
        ) : null}
      </div>
    </div>
  );
}

/**
 * Fixed sidebar on desktop; on a phone, a bottom tab bar whose More opens the
 * same nav as a sheet (QDIT-34). The shell carries no colour of
 * its own beyond the active nav item — it sits one rung below the page on the
 * surface ladder so content reads as raised.
 */
export function AppShell({
  projects,
  email,
  notifications,
  unread,
  children,
}: {
  projects: ProjectOption[];
  email: string;
  /** Rendered by the layout on every navigation — see `NotificationBell`. */
  notifications: NotificationRow[];
  unread: number;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const activeSlug = useActiveSlug();

  return (
    // `viewportFit: "cover"` (root layout) hands the whole screen to the page,
    // so the shell keeps clear of the notch and the status bar itself.
    <div className="flex min-h-screen flex-col pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)]">
      {/* Its own Suspense: it reads the search params, which would otherwise
          suspend the whole shell. */}
      <Suspense fallback={null}>
        <NavigationProgress />
      </Suspense>

      {/* Solid, not translucent — the spec rules out glass, and depth here
          comes from the surface ladder instead. */}
      <header className="bg-sidebar sticky top-0 z-40 border-b pt-[env(safe-area-inset-top)]">
        <div className="flex h-14 items-center gap-3 px-4 lg:px-6">
          <Link href="/dashboard" className="transition-qdit shrink-0 hover:opacity-80">
            <QditLogo />
          </Link>

          <div className="ml-auto flex items-center gap-1">
            <NotificationBell notifications={notifications} unread={unread} />
            <ThemeToggle />
            <UserMenu email={email} />
          </div>
        </div>
      </header>

      <div className="flex flex-1">
        <aside className="bg-sidebar hidden w-64 shrink-0 border-r py-4 lg:block">
          <div className="sticky top-18">
            <SidebarBody projects={projects} />
          </div>
        </aside>

        {/* Gutters stay generous; only the vertical rhythm tightens. Density is
            a property of the content, not the frame (spec §Density). */}
        {/* Bottom padding clears the tab bar and the home indicator on a
            phone; from `lg` there is no tab bar to clear. */}
        <main className="min-w-0 flex-1 px-4 pt-6 pb-[calc(5rem+env(safe-area-inset-bottom))] lg:px-8 lg:pb-6">
          {children}
        </main>
      </div>

      <MobileTabBar slug={activeSlug} moreOpen={open} onMore={() => setOpen(true)} />

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="bottom"
          className="max-h-[85vh] overflow-y-auto rounded-t-2xl p-0 pt-4 pb-[env(safe-area-inset-bottom)] lg:hidden"
        >
          <SheetTitle className="sr-only">More</SheetTitle>
          <SidebarBody projects={projects} onNavigate={() => setOpen(false)} withHelp />
        </SheetContent>
      </Sheet>
    </div>
  );
}
