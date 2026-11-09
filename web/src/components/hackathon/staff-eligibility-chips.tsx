import { Hint } from "@/components/hint";
import { StatusBadge } from "@/components/status-badge";
import { TONE_BADGE } from "@/lib/constants";
import { RULE_LABEL } from "@/lib/hackathon/staff-view";
import type { EligibilityResult } from "@/lib/hackathon/types";
import { ICON } from "@/lib/icons";
import { cn } from "@/lib/utils";

/**
 * One chip per eligibility rule, pass or fail, with the rule's own reason in
 * a tooltip (WP-4.7, D-119). The override, when there is one, is shown first
 * because it is what counts.
 */
export function StaffEligibilityChips({
  eligibility,
  override,
  overrideReason,
}: {
  eligibility: EligibilityResult | null;
  override: boolean | null;
  overrideReason: string | null;
}) {
  return (
    <div className="flex max-w-md flex-wrap items-center gap-1">
      {override != null ? (
        <Hint label={`Override: ${overrideReason ?? ""}`}>
          <button type="button" className="focus-ring rounded-md">
            <StatusBadge
              state={{
                label: override ? "Override: eligible" : "Override: not eligible",
                tone: override ? "accent" : "destructive",
              }}
            />
          </button>
        </Hint>
      ) : null}
      {eligibility == null ? (
        <StatusBadge state={{ label: "Not checked yet", tone: "neutral" }} />
      ) : (
        eligibility.rules.map((rule) => (
          <Hint key={rule.id} label={rule.reason || (rule.passed ? "Passed" : "Failed")}>
            <button
              type="button"
              className="focus-ring rounded-md"
              aria-label={`${RULE_LABEL[rule.id]}: ${rule.passed ? "passed" : "failed"}. ${rule.reason}`}
            >
              {/* A glyph as well as the colour, so pass and fail differ without it. */}
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset",
                  TONE_BADGE[rule.passed ? "success" : "destructive"],
                )}
              >
                {rule.passed ? (
                  <ICON.verified aria-hidden className="size-3" />
                ) : (
                  <ICON.failed aria-hidden className="size-3" />
                )}
                {RULE_LABEL[rule.id]}
              </span>
            </button>
          </Hint>
        ))
      )}
    </div>
  );
}
