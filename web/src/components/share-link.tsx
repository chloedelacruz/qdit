"use client";

import { useSyncExternalStore } from "react";
import { toast } from "sonner";

import { DisabledReason, Hint, IconAction } from "@/components/hint";
import { Button } from "@/components/ui/button";
import { ICON } from "@/lib/icons";
import { cn } from "@/lib/utils";

/**
 * The public proof link, inline (QDIT-34). Replaces the share dialog.
 *
 * The dialog existed so the sharer could see what they hand over before they
 * hand it over. That still holds: the row's copy toast shows the full URL, and
 * the milestone page renders it in full with copy and open beside it — no
 * modal in either place.
 *
 * Disabled until the milestone is anchored. The public page of an unanchored
 * milestone only says there is nothing on the ledger yet, which is not a
 * proof anyone should be sent.
 *
 * The URL is built from `location.origin` in the browser, for the reason the
 * dialog gave: server-side it would need a configured public base URL, one
 * more variable to get wrong and silently emit links to the wrong host.
 */
function useOrigin(): string {
  return useSyncExternalStore(
    () => () => {},
    () => window.location.origin,
    () => "",
  );
}

export function publicProofPath(projectSlug: string, milestoneId: string): string {
  return `/p/${projectSlug}/${milestoneId}`;
}

async function copy(url: string) {
  try {
    await navigator.clipboard.writeText(url);
    toast.success("Public link copied", { description: url });
  } catch {
    // The clipboard API fails quietly in plenty of contexts. Show the link so
    // it can still be copied by hand.
    toast.message("Copy this link", { description: url });
  }
}

const NOT_ANCHORED = "Anchor this milestone first — its public page has no proof to show yet.";

/** Row-sized: one icon that copies the link. */
export function ShareLinkButton({
  projectSlug,
  milestoneId,
  anchored,
  anchoring = true,
  className,
}: {
  projectSlug: string;
  milestoneId: string;
  anchored: boolean;
  /**
   * Whether this deployment can anchor at all. Without a contract there is no
   * "anchor first" to ask for, so the link is offered as it always was.
   */
  anchoring?: boolean;
  className?: string;
}) {
  const origin = useOrigin();
  const url = `${origin}${publicProofPath(projectSlug, milestoneId)}`;

  if (!anchored && anchoring) {
    return (
      <DisabledReason reason={NOT_ANCHORED} className={className}>
        <span className="grid size-6 place-items-center rounded-md text-muted-foreground/50 pointer-coarse:size-11">
          <ICON.share className="size-4" />
          {/* Names the action; the wrapper adds why it is unavailable. */}
          <span className="sr-only">Copy public link</span>
        </span>
      </DisabledReason>
    );
  }

  return (
    <IconAction
      label="Copy public link"
      icon={ICON.share}
      onClick={() => copy(url)}
      className={className}
    />
  );
}

/** Page-sized: the URL itself, with copy and open. */
export function ShareLinkField({
  projectSlug,
  milestoneId,
  anchored,
  anchoring = true,
  className,
}: {
  projectSlug: string;
  milestoneId: string;
  anchored: boolean;
  /** See `ShareLinkButton`. */
  anchoring?: boolean;
  className?: string;
}) {
  const origin = useOrigin();
  const path = publicProofPath(projectSlug, milestoneId);
  const url = `${origin}${path}`;

  return (
    <div
      className={cn(
        "well flex min-w-0 items-center gap-1 rounded-md border border-border py-1 pr-1 pl-2.5",
        className,
      )}
    >
      <ICON.public aria-hidden className="size-3.5 text-muted-foreground" />
      <span data-slot="hash" className="min-w-0 flex-1 truncate text-xs">
        {url}
      </span>
      {anchored || !anchoring ? (
        <>
          <Hint label="Copy public link">
            <Button variant="ghost" size="icon-xs" aria-label="Copy public link" onClick={() => copy(url)}>
              <ICON.copy />
            </Button>
          </Hint>
          <Hint label="Open public page">
            <Button asChild variant="ghost" size="icon-xs">
              <a href={path} target="_blank" rel="noreferrer noopener" aria-label="Open public page">
                <ICON.external />
              </a>
            </Button>
          </Hint>
        </>
      ) : (
        <DisabledReason reason={NOT_ANCHORED}>
          <Button variant="ghost" size="icon-xs" disabled aria-label="Copy public link">
            <ICON.copy />
          </Button>
        </DisabledReason>
      )}
    </div>
  );
}
