import { cn } from "@/lib/utils";

/**
 * The qdit mark — a continuous folded ribbon that reads as an abstract
 * lowercase "q": a rounded body with a tail at ~45°, wrapped around an open
 * rounded-triangle negative space.
 *
 * Per the design spec this is never a checkmark or a clipboard, and the
 * negative space stays open.
 */

type MarkProps = {
  className?: string;
  /** Flat single-colour rendering. Use inside dense UI; gradient is branding-only. */
  flat?: boolean;
  title?: string;
};

export function QditMark({ className, flat = false, title }: MarkProps) {
  // SVG ids are document-scoped, so repeated marks emit duplicate ids. That is
  // harmless here: every instance defines the *same* gradients and mask, so a
  // browser resolving to the first match renders identically either way. The
  // `flat` variant differs only in which fill it references, not in the defs.
  const uid = "qdit";

  return (
    <svg
      viewBox="0 0 40 40"
      fill="none"
      role={title ? "img" : "presentation"}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      className={cn("size-8", className)}
    >
      {title ? <title>{title}</title> : null}

      <defs>
        <linearGradient id={`${uid}-fill`} x1="4" y1="4" x2="34" y2="36" gradientUnits="userSpaceOnUse">
          <stop stopColor="#6D5EF8" />
          <stop offset="1" stopColor="#7B61FF" />
        </linearGradient>

        {/* The fold: a soft internal shading pass, never a hard edge. */}
        <linearGradient id={`${uid}-fold`} x1="10" y1="6" x2="24" y2="30" gradientUnits="userSpaceOnUse">
          <stop stopColor="#FFFFFF" stopOpacity="0.34" />
          <stop offset="0.55" stopColor="#FFFFFF" stopOpacity="0.04" />
          <stop offset="1" stopColor="#0F172A" stopOpacity="0.16" />
        </linearGradient>

        <mask id={`${uid}-cut`}>
          <rect width="40" height="40" fill="#000" />
          {/* Body: circle tangent-swept into a tail tip at ~45°. */}
          <path
            d="M31.71 15.17 A14 14 0 1 0 15.17 31.71 L35.4 35.4 Z"
            fill="#FFF"
            stroke="#FFF"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
          {/* Open negative space — rounded triangle, apex up. */}
          <path
            d="M18 11.5 L24.6 23 L11.4 23 Z"
            fill="#000"
            stroke="#000"
            strokeWidth="5.6"
            strokeLinejoin="round"
          />
        </mask>
      </defs>

      <g mask={`url(#${uid}-cut)`}>
        <rect width="40" height="40" fill={flat ? "currentColor" : `url(#${uid}-fill)`} />
        {flat ? null : <rect width="40" height="40" fill={`url(#${uid}-fold)`} />}
      </g>
    </svg>
  );
}

type WordmarkProps = {
  className?: string;
  /** Spec: the wordmark is always lowercase. */
  children?: never;
};

export function QditWordmark({ className }: WordmarkProps) {
  return (
    <span
      className={cn(
        "font-heading text-[1.375rem] leading-none font-semibold tracking-[-0.045em] lowercase",
        className,
      )}
    >
      qdit
    </span>
  );
}

export function QditLogo({
  className,
  markClassName,
  flat,
}: {
  className?: string;
  markClassName?: string;
  flat?: boolean;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <QditMark className={cn("size-7", markClassName)} flat={flat} title="qdit" />
      <QditWordmark />
    </span>
  );
}
