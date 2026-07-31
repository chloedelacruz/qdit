"use client";

import { Menu } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { QditLogo } from "@/components/brand/qdit-mark";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { BUILD_NAV, FOOTER_NAV, PRIMARY_NAV } from "./nav-items";
import { SidebarNav } from "./sidebar-nav";

function SidebarBody({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <div className="flex h-full flex-col gap-1 px-3 pb-4">
      <SidebarNav items={PRIMARY_NAV} onNavigate={onNavigate} />
      <SidebarNav items={BUILD_NAV} label="Build" onNavigate={onNavigate} />
      <div className="mt-auto pt-4">
        <SidebarNav items={FOOTER_NAV} label="Workspace" onNavigate={onNavigate} />
      </div>
    </div>
  );
}

/**
 * Fixed sidebar on desktop, sheet on mobile. Generous whitespace and a single
 * hairline separator — the spec asks for quiet chrome, so the shell carries no
 * colour of its own beyond the active nav item.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex min-h-screen flex-col">
      <header className="bg-background/80 sticky top-0 z-40 border-b backdrop-blur-sm">
        <div className="flex h-14 items-center gap-3 px-4 lg:px-6">
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open navigation">
                <Menu />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-64 p-0 pt-14">
              <SheetTitle className="sr-only">Navigation</SheetTitle>
              <SidebarBody onNavigate={() => setOpen(false)} />
            </SheetContent>
          </Sheet>

          <Link href="/dashboard" className="transition-qdit shrink-0 hover:opacity-80">
            <QditLogo />
          </Link>

          <div className="ml-auto flex items-center gap-1">
            <ThemeToggle />
          </div>
        </div>
      </header>

      <div className="flex flex-1">
        <aside className="hidden w-60 shrink-0 border-r py-4 lg:block">
          <div className="sticky top-18">
            <SidebarBody />
          </div>
        </aside>

        <main className="min-w-0 flex-1 px-4 py-8 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
