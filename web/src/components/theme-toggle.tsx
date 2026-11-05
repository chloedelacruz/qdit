"use client";

import { useTheme } from "next-themes";

import { Button } from "@/components/ui/button";
import { ICON } from "@/lib/icons";

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Toggle theme"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
    >
      {/* Which icon shows is decided by the `dark` class, not React state — that
          keeps the server and client markup identical, so no mounted guard. */}
      <ICON.light className="dark:hidden" />
      <ICON.dark className="hidden dark:block" />
    </Button>
  );
}
