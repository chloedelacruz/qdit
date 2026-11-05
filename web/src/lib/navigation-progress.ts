/**
 * "A navigation is under way" — one bit of app-wide state (QDIT-35).
 *
 * The App Router has no navigation events, and a click on a dynamic route that
 * has not been prefetched shows nothing until the server answers. To the person
 * clicking, that reads as "it didn't register". This store is what the click
 * flips the instant it happens, and what the top progress bar reads; the new
 * route rendering flips it back.
 *
 * A plain external store rather than React context, so a click listener on the
 * document and `router.push` callers can start it without a provider in reach,
 * and `useSyncExternalStore` can read it without a re-render cascade.
 */

type Listener = () => void;

/** Nothing should look busy forever if a navigation never completes. */
export const NAVIGATION_TIMEOUT_MS = 15_000;

let pending = false;
let timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<Listener>();

function emit() {
  for (const listener of listeners) listener();
}

export function startNavigation(): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(doneNavigation, NAVIGATION_TIMEOUT_MS);
  if (pending) return;
  pending = true;
  emit();
}

/**
 * For navigations made in code (`router.push`/`replace`), which no click
 * listener sees. Starts only when the target differs from the page showing —
 * a same-URL push renders nothing new, so nothing would ever clear it.
 */
export function startNavigationTo(href: string): void {
  if (typeof window === "undefined") return;
  const url = new URL(href, window.location.href);
  if (url.pathname === window.location.pathname && url.search === window.location.search) return;
  startNavigation();
}

export function doneNavigation(): void {
  if (timer) clearTimeout(timer);
  timer = undefined;
  if (!pending) return;
  pending = false;
  emit();
}

export function subscribeNavigation(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function isNavigating(): boolean {
  return pending;
}

/**
 * Whether a click on this anchor is an in-app navigation the router will
 * handle — the only clicks worth showing progress for.
 *
 * Left button, no modifier (those open a new tab), not already handled, same
 * origin, same window, not a download, and not the page that is already
 * showing: a same-URL click never renders anything new, so it would never
 * clear. A hash-only change on the same page is not a navigation either.
 */
export function isTrackedNavigation(
  event: Pick<MouseEvent, "button" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey" | "defaultPrevented">,
  anchor: Pick<HTMLAnchorElement, "href" | "target" | "hasAttribute">,
  current: Pick<Location, "origin" | "pathname" | "search">,
): boolean {
  if (event.defaultPrevented || event.button !== 0) return false;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
  if (anchor.target && anchor.target !== "_self") return false;
  if (anchor.hasAttribute("download")) return false;

  let url: URL;
  try {
    url = new URL(anchor.href);
  } catch {
    return false;
  }

  if (url.origin !== current.origin) return false;
  // Route handlers (exports, API) are downloads or JSON, not pages.
  if (url.pathname.startsWith("/api/")) return false;
  return url.pathname !== current.pathname || url.search !== current.search;
}
