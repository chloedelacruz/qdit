"use client";

import { useSyncExternalStore } from "react";

const noSubscription = () => () => {};

/**
 * A timestamp in the reader's own locale and time zone.
 *
 * Formatted on the client because the server is rarely where the reader is:
 * a server-rendered `toLocaleString()` prints the host's zone with no zone
 * shown, which reads as local time and is not. Until hydration it renders the
 * UTC minute, so server and first client markup match and nothing is blank.
 */
export function LocalTime({ iso, className }: { iso: string; className?: string }) {
  const hydrated = useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );

  const text = hydrated
    ? new Date(iso).toLocaleString()
    : `${new Date(iso).toISOString().replace("T", " ").slice(0, 16)} UTC`;

  return (
    <time dateTime={iso} className={className}>
      {text}
    </time>
  );
}
