"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { decideAuthorization, type ConsentState } from "./actions";

const EMPTY: ConsentState = {};

/**
 * Allow / Deny.
 *
 * One form, two submit buttons carrying `decision`, so the choice travels with
 * the button that was pressed and there is no client state to get out of step
 * with it. Both lock while either is in flight: a second click would post a
 * second decision on a request Auth has already closed.
 *
 * Deny is not the destructive variant. Refusing is the safe answer here, and
 * painting it red would make it look like the risky one.
 */
export function ConsentForm({
  authorizationId,
  clientName,
}: {
  authorizationId: string;
  clientName: string;
}) {
  const [state, formAction, pending] = useActionState(decideAuthorization, EMPTY);

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="authorization_id" value={authorizationId} />

      {state.error ? (
        <p role="alert" className="text-xs text-destructive">
          {state.error}
        </p>
      ) : null}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="submit" name="decision" value="deny" variant="outline" disabled={pending}>
          Deny
        </Button>
        <Button type="submit" name="decision" value="approve" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" data-icon="inline-start" /> : null}
          Allow {clientName}
        </Button>
      </div>
    </form>
  );
}
