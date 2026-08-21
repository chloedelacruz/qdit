"use client";

import { useOptimistic, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
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
      else toast.success(next ? "Proofs are now public" : "Proofs are private again");
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <span className="text-xs font-medium text-muted-foreground">Public proofs</span>

      <p className="min-w-0 flex-1 text-sm">
        {optimistic ? (
          <>
            <span className="text-success">On.</span> Anyone with a milestone
            link can open its proof — title, status, hashes and decisions. Tasks,
            descriptions and member names are never included.
          </>
        ) : (
          <>
            <span className="text-muted-foreground">Off.</span> Proof pages need
            a sign-in, so anyone outside the project has to be sent a screenshot.
          </>
        )}
      </p>

      {canEdit ? (
        <Button variant="outline" size="sm" onClick={toggle} disabled={pending}>
          {optimistic ? "Make private" : "Publish proofs"}
        </Button>
      ) : null}
    </div>
  );
}
