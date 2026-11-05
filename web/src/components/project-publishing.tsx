"use client";

import { useOptimistic, useTransition } from "react";
import { toast } from "sonner";

import { DisabledReason, InfoBubble } from "@/components/hint";
import { Button } from "@/components/ui/button";
import { ICON } from "@/lib/icons";
import { setProjectPublicProofs } from "@/lib/actions";

/**
 * Whether this project's milestone proofs can be opened without an account.
 *
 * Its own control, not a field on the edit form, because it is the one setting
 * whose effect is outside the workspace — and because the sentence next to it
 * is the important part. Somebody flipping this is publishing, and they should
 * read what that means at the moment they do it rather than find out later.
 *
 * Admin-gated by RLS rather than by hiding the button: `projects: update as
 * admin` is what actually decides, and a member who tries gets the policy's
 * refusal rather than a control that silently does nothing.
 */
export function ProjectPublishing({
  projectId,
  publicProofs,
  canEdit,
}: {
  projectId: string;
  publicProofs: boolean;
  canEdit: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [optimistic, setOptimistic] = useOptimistic(publicProofs);

  function toggle() {
    const next = !optimistic;

    startTransition(async () => {
      setOptimistic(next);
      const result = await setProjectPublicProofs(projectId, next);

      if (result.error) toast.error(result.error);
      // The explainer is behind the ⓘ now, so the moment of publishing says
      // what was published — the sentence that matters, when it matters.
      else if (next)
        toast.success("Proofs are now public", {
          description:
            "Title, status, hashes and decisions. Never tasks, descriptions or member names.",
        });
      else toast.success("Proofs are private again");
    });
  }

  const State = optimistic ? ICON.public : ICON.private;
  const button = (
    <Button variant="outline" size="sm" onClick={toggle} disabled={pending || !canEdit}>
      {optimistic ? "Make private" : "Publish proofs"}
    </Button>
  );

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <State
          aria-hidden
          className={optimistic ? "size-3.5 text-success" : "size-3.5"}
        />
        {optimistic ? "Public proofs" : "Private proofs"}
      </span>

      <InfoBubble label="public proofs">
        {optimistic ? (
          <p>
            Anyone with a milestone link can open its proof — title, status,
            hashes and decisions. Tasks, descriptions and member names are never
            included.
          </p>
        ) : (
          <p>
            Proof pages need a sign-in, so anyone outside the project has to be
            sent a screenshot. Publishing gives each milestone a public link.
          </p>
        )}
      </InfoBubble>

      <span className="ml-auto">
        {canEdit ? (
          button
        ) : (
          <DisabledReason reason="Only a project admin can change this.">{button}</DisabledReason>
        )}
      </span>
    </div>
  );
}
