"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Bell } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { markNotificationsRead } from "@/lib/actions";
import type { NotificationRow } from "@/lib/queries";
import { cn } from "@/lib/utils";

/**
 * What happened while you were not looking.
 *
 * ---------------------------------------------------------------------------
 * WHY IT EXISTS
 * ---------------------------------------------------------------------------
 * Five of twenty testers described the same hole from different angles. One
 * discovered their milestone had been approved by refreshing the page for an
 * unrelated reason. One waited two days on a submission, concluded nobody had
 * looked at it, and rated the product 1. Nothing was broken; the app simply
 * never spoke first.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT DELIBERATELY IS NOT
 * ---------------------------------------------------------------------------
 * Not live. There is no subscription and no polling: the list is rendered by
 * the server on navigation, and marking read revalidates. The complaint was
 * "I never found out", not "I found out four seconds late", and a socket per
 * signed-in tab is a real cost to carry for the difference.
 *
 * Opening the bell marks everything read, including rows further down than the
 * eye reached. That is the honest trade for not having per-row read tracking —
 * the alternative is a badge that never clears and therefore stops meaning
 * anything.
 */
export function NotificationBell({
  notifications,
  unread,
}: {
  notifications: NotificationRow[];
  unread: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [, startTransition] = useTransition();
  // Cleared locally the moment the panel opens. The server catches up on the
  // revalidate, and a count that lingers for a round trip reads as a bug.
  const [seen, setSeen] = useState(false);

  const count = seen ? 0 : unread;

  function onOpenChange(next: boolean) {
    setOpen(next);

    if (next && unread > 0 && !seen) {
      setSeen(true);
      startTransition(async () => {
        await markNotificationsRead();
      });
    }
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={
            count > 0 ? `Notifications, ${count} unread` : "Notifications, none unread"
          }
        >
          <Bell />
          {count > 0 ? (
            <span
              aria-hidden
              className={cn(
                "bg-primary text-primary-foreground absolute top-1 right-1",
                "flex min-w-4 items-center justify-center rounded-full px-1",
                "text-[10px] leading-4 font-medium tabular-nums",
              )}
            >
              {count > 9 ? "9+" : count}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-80 p-0">
        <div className="border-b px-3 py-2">
          <p className="text-sm font-medium">Notifications</p>
        </div>

        {notifications.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">
            Nothing yet. Approvals, rejections and submissions on your projects
            land here.
          </p>
        ) : (
          <ScrollArea viewportClassName="max-h-80">
            <ul>
              {notifications.map((notification) => (
                <li key={notification.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      router.push(
                        `/projects/${notification.projectSlug}/milestones`,
                      );
                    }}
                    className={cn(
                      "focus-ring transition-qdit w-full border-b px-3 py-2.5 text-left last:border-b-0",
                      "hover:bg-accent/40",
                    )}
                  >
                    <p className="text-sm leading-5">{notification.body}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {relativeTime(notification.createdAt)}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          </ScrollArea>
        )}
      </PopoverContent>
    </Popover>
  );
}

/**
 * "3h ago", not a timestamp.
 *
 * A bell answers "is this news?", and a date answers a different question.
 * Rendered on the client on purpose: the server and the reader are rarely in
 * the same timezone, and a server-rendered relative time is wrong the moment
 * the page has been open for a minute.
 */
function relativeTime(iso: string): string {
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);

  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604_800) return `${Math.floor(seconds / 86_400)}d ago`;

  return new Date(iso).toLocaleDateString();
}
