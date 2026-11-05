import Link from "next/link";

import { cn } from "@/lib/utils";
import { InfoBubble } from "@/components/hint";
import { ICON } from "@/lib/icons";

export type Crumb = { label: string; href?: string };

export function PageHeader({
  title,
  info,
  description,
  actions,
  breadcrumb,
  meta,
  className,
}: {
  title: string;
  /**
   * What this page is for, behind an ⓘ beside the title (QDIT-34). For the
   * explainer sentence every page used to print under its heading.
   */
  info?: string;
  /** Content, shown as text: a project's own description, written by a person. */
  description?: string;
  actions?: React.ReactNode;
  /** Ancestor trail. The current page is the title, so it is not repeated here. */
  breadcrumb?: Crumb[];
  /** Badges or counts rendered beside the title. */
  meta?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-5", className)}>
      {breadcrumb && breadcrumb.length > 0 ? (
        <nav aria-label="Breadcrumb" className="mb-2">
          <ol className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
            {breadcrumb.map((crumb, index) => (
              <li key={`${crumb.label}-${index}`} className="flex items-center gap-1">
                {index > 0 ? <ICON.chevronRight className="size-3 opacity-50" /> : null}
                {crumb.href ? (
                  <Link href={crumb.href} className="transition-qdit hover:text-foreground">
                    {crumb.label}
                  </Link>
                ) : (
                  <span>{crumb.label}</span>
                )}
              </li>
            ))}
          </ol>
        </nav>
      ) : null}

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-lg">{title}</h1>
            {info ? (
              <InfoBubble label={title}>
                <p>{info}</p>
              </InfoBubble>
            ) : null}
            {meta}
          </div>
          {description ? (
            <p className="max-w-prose text-sm text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {/* Wraps under the title on a narrow screen instead of pushing the page
            sideways. */}
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  /**
   * What this page is for, behind an ⓘ beside the title (QDIT-34). For the
   * explainer sentence every page used to print under its heading.
   */
  info?: string;
  /** Content, shown as text: a project's own description, written by a person. */
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="well flex flex-col items-center justify-center rounded-xl border border-dashed border-border-strong px-6 py-16 text-center">
      {Icon ? (
        <span className="surface mb-4 flex size-10 items-center justify-center rounded-xl border border-border text-muted-foreground">
          <Icon className="size-5" />
        </span>
      ) : null}
      <h2 className="text-sm font-semibold">{title}</h2>
      {description ? (
        <p className="mt-1.5 max-w-sm text-sm text-muted-foreground">{description}</p>
      ) : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
