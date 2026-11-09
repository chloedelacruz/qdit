import { toPlainText } from "@/lib/hackathon/staff-view";
import { cn } from "@/lib/utils";

/**
 * Team-written content (a note's markdown, a description) shown exactly as
 * typed, as text (WP-4.7, QDIT-48). Never rendered as markdown or HTML: the
 * string is a React text child, which React escapes, so `<img onerror>` in a
 * note is the characters `<img onerror>` on screen. Long content scrolls
 * inside its own box instead of stretching the page.
 */
export function StaffPlainText({
  value,
  max,
  className,
}: {
  value: unknown;
  max?: number;
  className?: string;
}) {
  const text = toPlainText(value, max);
  return (
    <pre
      className={cn(
        "well max-h-80 overflow-auto rounded-lg px-3 py-2 font-mono text-xs leading-5 whitespace-pre-wrap break-words",
        className,
      )}
    >
      {text === "" ? "(empty)" : text}
    </pre>
  );
}
