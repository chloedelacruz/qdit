"use client";

import { LogOut, Settings2 } from "lucide-react";
import Link from "next/link";
import { useRef } from "react";

import { signOut } from "@/app/login/actions";
import { disconnectWallet } from "@/lib/wallet";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/** Initials from an email local part, for the trigger. */
function initials(email: string): string {
  const local = email.split("@")[0] ?? "";
  const parts = local.split(/[._-]+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0][0] + parts[1][0] : local.slice(0, 2);
  return letters.toUpperCase() || "?";
}

export function UserMenu({ email }: { email: string }) {
  const form = useRef<HTMLFormElement>(null);

  /**
   * Signing out has to drop the wallet too.
   *
   * The session and the wallet connection are stored in different places — a
   * cookie the server clears, and localStorage only the kit can clear — so
   * clearing one leaves the other. That asymmetry is what made the next person
   * at this browser land on a signed-out app that still had somebody's address
   * connected and ready to be asked for a signature.
   *
   * Awaited before submitting rather than fired alongside it: the sign-out
   * navigates, and a localStorage write racing a navigation is a write that
   * sometimes does not happen.
   */
  async function signOutEverywhere(event: React.MouseEvent<HTMLButtonElement>) {
    event.preventDefault();

    try {
      await disconnectWallet();
    } catch {
      // A wallet that will not let go is not a reason to stay signed in.
    }

    form.current?.requestSubmit();
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={`Account: ${email}`}>
          <span className="flex size-6 items-center justify-center rounded-full bg-accent text-[0.625rem] font-medium text-accent-foreground">
            {initials(email)}
          </span>
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="truncate font-normal text-muted-foreground">
          {email}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        <DropdownMenuItem asChild>
          <Link href="/settings">
            <Settings2 className="size-4" />
            Settings
          </Link>
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        {/* A sign-out that mutates a session must not be a GET link — a prefetch
            or a link scanner would log the user out. Form post to a server
            action instead. */}
        <form ref={form} action={signOut}>
          <button
            type="submit"
            onClick={(event) => void signOutEverywhere(event)}
            className="relative flex w-full cursor-default items-center gap-1.5 rounded-md px-1.5 py-1 text-sm outline-hidden select-none hover:bg-accent hover:text-accent-foreground"
          >
            <LogOut className="size-4" />
            Sign out
          </button>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
