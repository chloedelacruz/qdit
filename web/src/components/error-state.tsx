"use client";

import Link from "next/link";

import { Button } from "@/components/ui/button";
import { ICON } from "@/lib/icons";
import { cn } from "@/lib/utils";

/**
 * The fallback every `error.tsx` in the app renders.
 *
 * Error boundaries must be Client Components, and each route segment needs its
 * own file — so the files are thin and the surface lives here, the same way
 * every `loading.tsx` is a one-line wrapper over `PageSkeleton`.
 *
 * What it has to say is shaped by where the errors come from. Mutations in this
 * app never reach a boundary: they return `ActionState` and render failures
 * inline on the form. What lands here is a failed *read* — an expired session
 * hitting a Server Component, or Supabase being unreachable — which the person
 * looking at it did not cause and cannot fix by editing anything. So the two
 * things offered are retrying and leaving, and the digest is surfaced because
 * it is the only handle anyone has on the server-side log.
 */
export function ErrorState({
  error,
  retry,
  title = "This did not load",
  description,
  className,
}: {
  error: Error & { digest?: string };
  /**
   * Next 16 passes this as `unstable_retry`, which re-fetches and re-renders
   * the segment. The older `reset` only clears the boundary's state without
   * re-fetching, which for a failed read just renders the same failure again.
   */
  retry?: () => void;
  title?: string;
  description?: string;
  className?: string;
}) {
  const Icon = ICON.error;

  return (
    <div
      className={cn(
        "well flex flex-col items-center justify-center rounded-xl border border-dashed border-border-strong px-6 py-16 text-center",
        className,
      )}
    >
      <span className="surface mb-4 flex size-10 items-center justify-center rounded-xl border border-border text-muted-foreground">
        <Icon className="size-5" />
      </span>

      <h2 className="text-sm font-semibold">{title}</h2>

      <p className="mt-1.5 max-w-sm text-sm text-muted-foreground">
        {description ??
          "Something went wrong fetching this page. It is usually the connection or an expired session, and trying again is often enough."}
      </p>

      <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
        {retry ? (
          <Button size="sm" onClick={() => retry()}>
            Try again
          </Button>
        ) : null}
        <Button asChild variant="outline" size="sm">
          <Link href="/dashboard">Back to dashboard</Link>
        </Button>
      </div>

      {/*
        A Server Component error reaches the client as a generic message plus
        this hash — the real one stays in the server log to avoid leaking it.
        Printing the digest is what makes the two matchable, so it is the one
        piece of the error worth showing. `error.message` is deliberately not
        rendered: in production it says nothing, and in development the overlay
        already says it better.
      */}
      {error.digest ? (
        <p className="mt-5 font-mono text-xs text-muted-foreground">
          Reference {error.digest}
        </p>
      ) : null}
    </div>
  );
}
