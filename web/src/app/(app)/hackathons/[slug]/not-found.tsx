import Link from "next/link";

import { EmptyState } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { ICON } from "@/lib/icons";

/** A hackathon link that does not resolve: a typo, or an event that was removed. */
export default function HackathonNotFound() {
  return (
    <EmptyState
      icon={ICON.missing}
      title="Hackathon not found"
      description="Check the link you were given. It may have a typo, or the event may have been removed."
      action={
        <Button asChild size="sm">
          <Link href="/dashboard">Back to dashboard</Link>
        </Button>
      }
    />
  );
}
