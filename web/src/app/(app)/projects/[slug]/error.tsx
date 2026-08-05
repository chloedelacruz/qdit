"use client";

import { ErrorState } from "@/components/error-state";

/**
 * One project's routes — overview, board, milestones, deployments, proofs.
 *
 * Worth its own boundary rather than falling through to `(app)/error.tsx`,
 * because the project layout resolves the slug and every page under it re-reads
 * the project. A failure here is about *this* project, so the copy says so
 * instead of blaming the whole workspace.
 */
export default function ProjectError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  return (
    <ErrorState
      error={error}
      retry={unstable_retry}
      title="This project did not load"
      description="The project could not be read just now. Your access may have changed, or the connection dropped mid-request."
    />
  );
}
