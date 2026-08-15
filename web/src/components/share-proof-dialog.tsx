"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Check, Copy } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * The link you can send to somebody who does not have an account.
 *
 * A dialog rather than a menu item that silently writes to the clipboard. Two
 * reasons, and the second is the real one: the clipboard API fails quietly in
 * plenty of browsers and contexts, and — more importantly — the person sharing
 * should see exactly what they are about to hand over before they hand it over.
 *
 * The URL is built in the browser from `location.origin`. Server-side it would
 * need a configured public base URL, which is one more thing to get wrong in an
 * environment variable and silently emit links to the wrong host.
 */
export function ShareProofDialog({
  projectSlug,
  milestoneId,
  milestoneTitle,
  anchored,
  open,
  onOpenChange,
}: {
  projectSlug: string;
  milestoneId: string;
  milestoneTitle: string;
  /** Nothing has been written to the ledger yet, so the page has little to show. */
  anchored: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  /*
    `useSyncExternalStore` rather than an effect that sets state.

    The origin is a browser fact with no server equivalent, so it needs a server
    snapshot ("") that differs from the client's — which is exactly what this
    hook exists to express. Reading it during render would be a hydration
    mismatch; setting it from an effect would be a cascading render. The
    subscribe function does nothing because the value never changes: a page that
    moved to a different origin is a different page.
  */
  const origin = useSyncExternalStore(
    () => () => {},
    () => window.location.origin,
    () => "",
  );
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);

  const url = `${origin}/p/${projectSlug}/${milestoneId}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Share this proof</DialogTitle>
          <DialogDescription>{milestoneTitle}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          {/*
            `min-w-0` is load-bearing.

            `DialogContent` is a grid, and a grid item defaults to
            `min-width: auto` — it refuses to shrink below its content's
            min-content width. A URL is one unbreakable string, so this row grew
            to the full length of it and overflowed the dialog, ellipsis and all.
            The `truncate` on the span inside cannot help while its ancestor is
            still being sized by the same text.
          */}
          <div className="well flex min-w-0 items-center gap-2 rounded-md border border-border py-1.5 pr-1.5 pl-3">
            <span data-slot="hash" className="min-w-0 flex-1 truncate text-xs">
              {url}
            </span>
            <Button
              variant="ghost"
              size="xs"
              aria-label={copied ? "Copied" : "Copy link"}
              onClick={async () => {
                await navigator.clipboard.writeText(url);
                setCopied(true);
              }}
            >
              {copied ? <Check className="text-success" /> : <Copy />}
            </Button>
          </div>

          <p className="text-muted-foreground">
            Opens without an account. It shows the milestone&apos;s title,
            status, anchor history and any decision reasons — never its tasks,
            description or member names.
          </p>

          {!anchored ? (
            <p className="text-warning">
              This milestone has not been anchored yet, so the page will say so
              rather than show a hash. Anchor it first if the point is proof.
            </p>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
