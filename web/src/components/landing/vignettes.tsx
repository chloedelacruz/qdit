import { Check, ChevronDown, Search } from "lucide-react";

import { ICON } from "@/lib/icons";
import { TONE_BADGE, TONE_DOT } from "@/lib/constants";
import { cn } from "@/lib/utils";

/**
 * Small, faithful fragments of real product surfaces, for the "how it works"
 * band.
 *
 * They are markup rather than screenshots on purpose: they follow the theme,
 * they stay sharp, and — because they are built from the same tokens the app
 * is — they cannot drift into showing an interface that does not exist.
 *
 * Each one is framed in a **well**. The spec's rule holds here as much as it
 * does in the app: the container recedes and the content inside it is raised,
 * never the reverse.
 */

function Frame({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        "well flex h-40 flex-col justify-center gap-2 overflow-hidden rounded-lg border border-border p-3",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Column label above a group of board cards — "In Progress  2". */
function ColumnLabel({ label, count }: { label: string; count: number }) {
  return (
    <div className="flex items-center gap-1.5 px-0.5">
      <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </span>
      <span className="text-xs text-muted-foreground/60 tabular-nums">{count}</span>
    </div>
  );
}

/** Track — the board, with one card mid-drag. */
export function TrackVignette() {
  return (
    <Frame>
      <ColumnLabel label="In Progress" count={2} />

      {/* The lifted card is the one under the cursor: one elevation step up and
          1px off the surface, exactly as the board does it. */}
      <div className="surface -translate-y-px rounded-lg border border-border/70 p-2.5 shadow-md">
        <p className="truncate text-xs font-medium">Publish the WASM to Testnet</p>
        <div className="mt-2 flex items-center gap-1.5">
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-md px-1.5 py-px text-xs font-medium ring-1 ring-inset",
              TONE_BADGE.warning,
            )}
          >
            P1
          </span>
          <span className="text-xs text-muted-foreground">2026-08-03</span>
          <span className="ml-auto flex size-4 items-center justify-center rounded-full bg-accent text-[9px] font-medium text-accent-foreground">
            TY
          </span>
        </div>
      </div>

      <div className="surface rounded-lg border border-border/70 p-2.5 opacity-70">
        <p className="truncate text-xs font-medium">Wire the approval flow</p>
      </div>
    </Frame>
  );
}

/** Anchor — the digest, and the moment it lands. */
export function AnchorVignette() {
  return (
    <Frame>
      <div className="flex items-center gap-1.5 px-0.5">
        <ICON.milestone className="size-3 text-muted-foreground" />
        <span className="truncate text-xs text-muted-foreground">Testnet deployment</span>
      </div>

      <div className="surface rounded-lg border border-border/70 p-2.5">
        <p className="text-xs text-muted-foreground">Proof digest</p>
        <p data-slot="hash" className="mt-1 text-xs leading-relaxed break-all">
          9a2a1cbb4e07d2f38c6a1b90e5d4c77a2f8b0e13c9a64d2e7b15f960
        </p>
      </div>

      <div className="flex items-center gap-1.5 px-0.5 text-success">
        <Check className="size-3 shrink-0" strokeWidth={2.5} />
        <span className="truncate text-xs font-medium">Written to the ledger</span>
        <span
          data-slot="hash"
          className="ml-auto shrink-0 text-xs text-muted-foreground"
        >
          #4,079,271
        </span>
      </div>
    </Frame>
  );
}

/** Verify — a pasted hash, answered. */
export function VerifyVignette() {
  return (
    <Frame>
      <div className="flex items-center gap-1.5">
        <div className="surface flex min-w-0 flex-1 items-center gap-1.5 rounded-lg border border-border/70 px-2 py-1.5">
          <Search className="size-3 shrink-0 text-muted-foreground/70" />
          <span data-slot="hash" className="truncate-hash text-xs">
            8b304006aa61517e988bcfd8565978fb
          </span>
        </div>
        <div className="surface hidden items-center gap-1 rounded-lg border border-border/70 px-2 py-1.5 text-xs sm:flex">
          Testnet
          <ChevronDown className="size-3 text-muted-foreground" />
        </div>
        <span className="rounded-lg bg-primary px-2 py-1.5 text-xs font-medium text-primary-foreground">
          Verify
        </span>
      </div>

      <dl className="mt-1 space-y-1.5 px-0.5">
        {[
          ["Result", "Succeeded"],
          ["Source", "GCLUTB…TKQZZI"],
          ["When", "2026-08-11 03:02 UTC"],
        ].map(([label, value]) => (
          <div key={label} className="flex items-center gap-3">
            <dt className="w-12 shrink-0 text-xs text-muted-foreground">{label}</dt>
            <dd
              className={cn(
                "truncate-hash text-xs",
                label === "Result" && "flex items-center gap-1 font-medium text-success",
              )}
            >
              {label === "Result" ? (
                <span className={cn("size-1.5 shrink-0 rounded-full", TONE_DOT.success)} />
              ) : null}
              {value}
            </dd>
          </div>
        ))}
      </dl>
    </Frame>
  );
}
