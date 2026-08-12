"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { QditLogo } from "@/components/brand/qdit-mark";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The landing page header.
 *
 * Sticky, and flush with the page until it has something to sit above — the
 * hairline and the surface tint arrive together on the first scroll, so the
 * bar reads as a plane the content passes under. No blur: the spec rules out
 * translucency, and depth here comes from the luminance step and the border.
 */
export function MarketingHeader() {
  const [lifted, setLifted] = useState(false);

  useEffect(() => {
    const onScroll = () => setLifted(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={cn(
        "transition-qdit sticky top-0 z-50 border-b",
        lifted ? "border-border bg-background" : "border-transparent",
      )}
    >
      <div className="mx-auto flex w-full max-w-6xl items-center gap-3 px-6 py-4">
        <Link href="/" aria-label="qdit — home" className="focus-ring rounded-md">
          <QditLogo />
        </Link>

        <div className="ml-auto flex items-center gap-2">
          <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
            <Link href="/proofs">Proof registry</Link>
          </Button>
          <ThemeToggle />
          <Button asChild size="sm">
            <Link href="/dashboard">Open app</Link>
          </Button>
        </div>
      </div>
    </header>
  );
}
