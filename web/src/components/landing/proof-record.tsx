"use client";

import { useEffect, useState } from "react";
import { Check, Copy, ExternalLink } from "lucide-react";

import { ICON } from "@/lib/icons";
import { TONE_BADGE, TONE_DOT } from "@/lib/constants";
import { cn } from "@/lib/utils";

/**
 * The hero's one object: a milestone record, whole.
 *
 * This is the entire argument for the product in a single card — the claim,
 * and underneath it the five values that let a stranger check the claim. It is
 * built from real markup rather than a screenshot so it themes with the page
 * and stays sharp at any density; the values are the seeded demo project's, the
 * same ones the capture in `video/` records.
 *
 * The one piece of motion is the verification settling from *checking* to
 * *succeeded*, because that transition is the product. It runs once and stops.
 */

/** Fields in the order the app's proof detail lists them. */
const FIELDS = [
  { label: "Proof digest", value: "9a2a1cbb…5f960", action: "copy" },
  { label: "Transaction", value: "8b304006…c22e52a7", action: "open" },
  { label: "Signer", value: "GCLUTB…TKQZZI", action: "copy" },
  { label: "Network", value: "Testnet" },
  { label: "Ledger", value: "4,079,271" },
] as const;

export function ProofRecord({ className }: { className?: string }) {
  const [verified, setVerified] = useState(false);

  useEffect(() => {
    // Reduced motion resolves on the next tick rather than after the beat: the
    // point is the outcome, and the outcome does not need to be animated to be
    // legible. The global reduced-motion block collapses the transition too, so
    // it lands as a straight cut.
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const timer = window.setTimeout(() => setVerified(true), reduced ? 0 : 1500);

    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div className={cn("relative", className)}>
      <div className="surface-raised rounded-xl border border-border">
        <div className="flex items-start gap-3 border-b border-border px-4 py-3.5">
          <ICON.milestone className="mt-0.5 size-4 shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium tracking-[0.1em] text-muted-foreground uppercase">
              Milestone
            </p>
            <p className="mt-1 truncate text-base font-semibold">Contract scaffold + tests</p>
          </div>
          <span
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
              TONE_BADGE.success,
            )}
          >
            <span className={cn("size-1.5 rounded-full", TONE_DOT.success)} />
            Approved
          </span>
        </div>

        <dl className="divide-y divide-border">
          {FIELDS.map(({ label, value, ...rest }) => {
            const action = "action" in rest ? rest.action : undefined;

            return (
              <div key={label} className="flex items-center gap-4 px-4 py-2.5">
                <dt className="w-24 shrink-0 text-xs text-muted-foreground">{label}</dt>
                <dd className="flex min-w-0 flex-1 items-center justify-end gap-1.5">
                  <span
                    data-slot={label === "Network" || label === "Ledger" ? undefined : "hash"}
                    className="truncate-hash text-xs"
                  >
                    {value}
                  </span>
                  {action === "copy" ? (
                    <Copy className="size-3 shrink-0 text-muted-foreground/60" />
                  ) : null}
                  {action === "open" ? (
                    <ExternalLink className="size-3 shrink-0 text-muted-foreground/60" />
                  ) : null}
                </dd>
              </div>
            );
          })}
        </dl>

        {/* The verification. Both states occupy the same box so nothing reflows
            when it resolves. */}
        <div
          className={cn(
            "transition-qdit flex items-center gap-2 rounded-b-xl border-t px-4 py-3",
            verified
              ? "border-success/20 bg-success/8 text-success"
              : "border-border text-muted-foreground",
          )}
        >
          {verified ? (
            <Check className="size-3.5 shrink-0" strokeWidth={2.5} />
          ) : (
            <ICON.anchor className="size-3.5 shrink-0 animate-pulse" />
          )}
          <p className="truncate text-xs font-medium">
            {verified ? "Succeeded — checked against Horizon" : "Checking against Horizon…"}
          </p>
          <span
            className={cn(
              "transition-qdit ml-auto shrink-0 text-xs tabular-nums",
              verified ? "opacity-100" : "opacity-0",
            )}
          >
            03:02 UTC
          </span>
        </div>
      </div>
    </div>
  );
}
