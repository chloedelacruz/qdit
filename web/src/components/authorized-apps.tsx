"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { revokeAuthorizedApp } from "@/lib/actions";
import type { AuthorizedApp } from "@/lib/auth/oauth-grants";

/**
 * Apps connected to this account through qdit's OAuth server, each with a way
 * to disconnect it.
 *
 * `apps === null` is "Auth would not say", not "none" — see
 * listAuthorizedApps() — and reads differently, so nobody is told they have
 * nothing connected when that was never checked.
 *
 * Revoking asks first. It is immediate and the app cannot undo it: the user
 * has to go back to that app and connect again, through the consent screen.
 */
export function AuthorizedApps({ apps }: { apps: AuthorizedApp[] | null }) {
  const [confirming, setConfirming] = useState<AuthorizedApp | null>(null);
  const [pending, startTransition] = useTransition();

  if (apps === null) {
    return (
      <p className="text-sm text-muted-foreground">
        Connected apps could not be loaded right now.
      </p>
    );
  }

  if (apps.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No apps are connected. When you allow an app such as doqtri to act for you, it shows up
        here.
      </p>
    );
  }

  function revoke(app: AuthorizedApp) {
    startTransition(async () => {
      const result = await revokeAuthorizedApp(app.clientId);

      if (result.error) {
        toast.error(result.error);
        return;
      }

      setConfirming(null);
      toast.success(`${app.name} disconnected`);
    });
  }

  return (
    <>
      <ul className="divide-y divide-border">
        {apps.map((app) => (
          <li key={app.clientId} className="flex items-center gap-3 py-2 first:pt-0 last:pb-0">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-sm font-medium">{app.name}</span>
                {app.host ? (
                  <span className="font-mono text-xs text-muted-foreground">{app.host}</span>
                ) : null}
              </div>
              <p className="text-xs text-muted-foreground">
                Connected <time dateTime={app.grantedAt}>{app.grantedAt.slice(0, 10)}</time>
                {app.scopes.length > 0
                  ? ` · ${app.scopes.map((scope) => scope.scope).join(", ")}`
                  : null}
              </p>
            </div>

            <Button
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() => setConfirming(app)}
            >
              Revoke
            </Button>
          </li>
        ))}
      </ul>

      <AlertDialog
        open={confirming !== null}
        onOpenChange={(open) => {
          if (!open && !pending) setConfirming(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect {confirming?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              It stops being able to act for you in qdit straight away. Anything it already
              created — milestones, links — stays. To use it with qdit again, connect from that
              app.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={pending}
              // Keep the dialog open until the action reports back, so a
              // failure has somewhere to render.
              onClick={(event) => {
                event.preventDefault();
                if (confirming) revoke(confirming);
              }}
            >
              {pending ? <Loader2 className="animate-spin" data-icon="inline-start" /> : null}
              Revoke
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
