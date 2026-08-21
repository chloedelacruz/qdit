"use client";

import { useState } from "react";

import { ShareProofDialog } from "@/components/share-proof-dialog";
import { ICON } from "@/lib/icons";
import { cn } from "@/lib/utils";

/**
 * A share control that is visible without being hunted for.
 *
 * It started life as an item inside the row's ⋯ menu, which is where a feature
 * goes to be undiscovered — the same mistake Re-submit was making, and a tester
 * had already told us what that costs. Public proof links are the answer to the
 * loudest complaint in the round ("everything needs a login, so I'm back to
 * screenshots"), and a person who does not know the feature exists will never
 * open a menu to look for it.
 *
 * So: always rendered when the project publishes, never hover-revealed, and
 * carrying the link glyph the app already uses for proof. It appears on a row
 * only when there is something to share — the toggle is on the project
 * overview, and a button offering a link to a page that would refuse to render
 * is worse than no button.
 */
export function ShareProofButton({
  projectSlug,
  milestoneId,
  milestoneTitle,
  anchored,
  className,
}: {
  projectSlug: string;
  milestoneId: string;
  milestoneTitle: string;
  anchored: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        aria-label="Share public link"
        title="Share public link"
        onClick={() => setOpen(true)}
        className={cn(
          "focus-ring transition-qdit grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground",
          "hover:bg-muted hover:text-foreground",
          className,
        )}
      >
        <ICON.proof className="size-4" />
      </button>

      <ShareProofDialog
        projectSlug={projectSlug}
        milestoneId={milestoneId}
        milestoneTitle={milestoneTitle}
        anchored={anchored}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  );
}
