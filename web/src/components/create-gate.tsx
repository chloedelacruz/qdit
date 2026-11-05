import { DisabledReason } from "@/components/hint";
import { Button } from "@/components/ui/button";
import { ICON } from "@/lib/icons";

/**
 * A create button for somebody whose role cannot create (QDIT-34).
 *
 * Viewers used to get the live button, fill in the whole form, and only learn
 * "no" from the error after submitting. Now they see the same button, disabled,
 * and hovering, focusing or tapping it says why before they start.
 */
export function CreateGate({
  allowed,
  label,
  reason = "Viewers can't create here. Ask a project admin for the member role.",
  children,
}: {
  allowed: boolean;
  /** The create button's own label, so the disabled one reads the same. */
  label: string;
  reason?: string;
  children: React.ReactNode;
}) {
  if (allowed) return <>{children}</>;

  return (
    <DisabledReason reason={reason}>
      <Button disabled>
        <ICON.add data-icon="inline-start" />
        {label}
      </Button>
    </DisabledReason>
  );
}
