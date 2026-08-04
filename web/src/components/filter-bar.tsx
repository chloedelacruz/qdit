"use client";

import { ListFilter, Search, X } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  SORT_KEYS,
  SORT_LABELS,
  activeFilterCount,
  clearFilters,
  hasActiveFilters,
  serialiseFilters,
  toggleFacet,
  type FacetKey,
  type Filters,
  type SortKey,
} from "@/lib/filters";
import { cn } from "@/lib/utils";

export type Facet = {
  key: FacetKey;
  label: string;
  options: { value: string; label: string }[];
};

/**
 * The single filter surface for every list in the app.
 *
 * All state lives in the URL — this component only computes the next URL and
 * navigates. That keeps filtered views shareable and refresh-safe, and means
 * the server components below it re-query without any client cache to sync.
 */
export function FilterBar({
  filters,
  facets,
  sorts = [...SORT_KEYS],
  placeholder = "Search…",
  className,
}: {
  filters: Filters;
  facets: Facet[];
  sorts?: SortKey[];
  placeholder?: string;
  className?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  const apply = (next: Filters) => {
    const query = serialiseFilters(next);
    startTransition(() => {
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    });
  };

  return (
    <div className={cn("mb-3 flex flex-wrap items-center gap-2", className)}>
      <SearchField
        value={filters.q}
        placeholder={placeholder}
        pending={isPending}
        onChange={(q) => apply({ ...filters, q, limit: filters.limit })}
      />

      {facets.map((facet) => (
        <FacetMenu
          key={facet.key}
          facet={facet}
          selected={filters[facet.key]}
          onToggle={(value) => apply(toggleFacet(filters, facet.key, value))}
        />
      ))}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm">
            {SORT_LABELS[filters.sort]}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>Sort by</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={filters.sort}
            onValueChange={(sort) => apply({ ...filters, sort: sort as SortKey })}
          >
            {sorts.map((key) => (
              <DropdownMenuRadioItem key={key} value={key}>
                {SORT_LABELS[key]}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      {hasActiveFilters(filters) ? (
        <Button variant="ghost" size="sm" onClick={() => apply(clearFilters(filters))}>
          <X data-icon="inline-start" />
          Clear
          <span className="ml-0.5 tabular-nums opacity-60">
            {activeFilterCount(filters)}
          </span>
        </Button>
      ) : null}
    </div>
  );
}

function SearchField({
  value,
  placeholder,
  pending,
  onChange,
}: {
  value: string;
  placeholder: string;
  pending: boolean;
  onChange: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const committed = useRef(value);

  // Keep in step when the URL changes from elsewhere (Clear, back button),
  // without clobbering what the user is mid-way through typing.
  useEffect(() => {
    if (value !== committed.current) {
      committed.current = value;
      setDraft(value);
    }
  }, [value]);

  // Debounced so each keystroke isn't a navigation.
  useEffect(() => {
    if (draft === committed.current) return;
    const timer = setTimeout(() => {
      committed.current = draft;
      onChange(draft);
    }, 280);
    return () => clearTimeout(timer);
  }, [draft, onChange]);

  return (
    <div className="relative min-w-52 flex-1 sm:max-w-xs">
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="search"
        role="searchbox"
        value={draft}
        placeholder={placeholder}
        aria-label={placeholder}
        data-pending={pending ? "true" : undefined}
        onChange={(event) => setDraft(event.target.value)}
        className="h-8 pl-8"
      />
    </div>
  );
}

function FacetMenu({
  facet,
  selected,
  onToggle,
}: {
  facet: Facet;
  selected: string[];
  onToggle: (value: string) => void;
}) {
  if (facet.options.length === 0) return null;

  const count = selected.length;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          /**
           * Named "Filter by status", not "Status": task rows carry their own
           * "Status: Todo" control, and two differently-behaved buttons sharing
           * a name is ambiguous to anyone navigating by accessible name.
           */
          aria-label={
            count > 0
              ? `Filter by ${facet.label.toLowerCase()} (${count} selected)`
              : `Filter by ${facet.label.toLowerCase()}`
          }
          // A facet that is narrowing results should look like it is.
          className={cn(count > 0 && "border-primary/40 text-foreground")}
        >
          <ListFilter data-icon="inline-start" />
          {facet.label}
          {count > 0 ? (
            <span className="ml-0.5 rounded bg-accent px-1 text-accent-foreground tabular-nums">
              {count}
            </span>
          ) : null}
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="min-w-44">
        <DropdownMenuLabel>{facet.label}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {facet.options.map((option) => (
          <DropdownMenuCheckboxItem
            key={option.value}
            checked={selected.includes(option.value)}
            // Radix closes on select by default; filtering is usually a
            // multi-step action, so keep the menu open.
            onSelect={(event) => event.preventDefault()}
            onCheckedChange={() => onToggle(option.value)}
          >
            {option.label}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
