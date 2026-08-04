"use client";

import { Menu } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { QditLogo } from "@/components/brand/qdit-mark";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import { FOOTER_NAV, WORKSPACE_NAV, projectNav } from "./nav-items";
import { ProjectSwitcher, type ProjectOption } from "./project-switcher";
import { SidebarNav } from "./sidebar-nav";
import { UserMenu } from "./user-menu";

/** The project slug the current route is scoped to, if any. */
function useActiveSlug(): string | undefined {
  const pathname = usePathname();
  // `/projects` (the index) has no slug; `/projects/atlas-escrow/board` does.
  return pathname.match(/^\/projects\/([^/]+)/)?.[1];
}

function SidebarBody({
  projects,
  onNavigate,
}: {
  projects: ProjectOption[];
  onNavigate?: () => void;
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
        <SidebarNav items={FOOTER_NAV} onNavigate={onNavigate} />
      </div>
    </div>
  );
}

/**
 * Fixed sidebar on desktop, sheet on mobile. The shell carries no colour of
 * its own beyond the active nav item — it sits one rung below the page on the
 * surface ladder so content reads as raised.
 */
export function AppShell({
  projects,
  email,
  children,
}: {
  projects: ProjectOption[];
  email: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex min-h-screen flex-col">
      {/* Solid, not translucent — the spec rules out glass, and depth here
          comes from the surface ladder instead. */}
      <header className="bg-sidebar sticky top-0 z-40 border-b">
        <div className="flex h-14 items-center gap-3 px-4 lg:px-6">
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open navigation">
                <Menu />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-72 p-0 pt-14">
              <SheetTitle className="sr-only">Navigation</SheetTitle>
              <SidebarBody projects={projects} onNavigate={() => setOpen(false)} />
            </SheetContent>
          </Sheet>

          <Link href="/dashboard" className="transition-qdit shrink-0 hover:opacity-80">
            <QditLogo />
          </Link>

          <div className="ml-auto flex items-center gap-1">
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
        <main className="min-w-0 flex-1 px-4 py-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
