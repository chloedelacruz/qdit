import { loginPath } from "@/lib/auth/next-path";

/**
 * The page a signed-out visitor asked for, carried to the `(app)` layout.
 *
 * A layout is not told its URL, so the gate in `app/(app)/layout.tsx` could
 * only ever send people to a bare `/login`, and a shared link such as
 * `/hackathons/<slug>` landed on the dashboard after sign-in. The proxy,
 * which does see the URL, writes it onto the request as this header; the
 * layout reads it back and redirects to `/login?next=<path>`.
 *
 * The proxy always overwrites the header, so a value a client sends is
 * replaced. A request the proxy did not see could still carry one, which is
 * why the value is never trusted: `loginPath()` keeps it only if it is a
 * same-origin relative path (lib/auth/next-path.ts).
 */
export const REQUEST_PATH_HEADER = "x-qdit-request-path";

/** Next's own cache-busting parameter on RSC requests; not part of the page. */
const RSC_PARAM = "_rsc";

/** `pathname` + `search` of `url`, without Next's internal `_rsc` parameter. */
export function requestPathOf(url: URL): string {
  const params = new URLSearchParams(url.search);
  params.delete(RSC_PARAM);
  const search = params.toString();
  return search ? `${url.pathname}?${search}` : url.pathname;
}

/** A copy of `headers` with the request path set from `url`, replacing any sent. */
export function withRequestPath(headers: Headers, url: URL): Headers {
  const copy = new Headers(headers);
  copy.set(REQUEST_PATH_HEADER, requestPathOf(url));
  return copy;
}

/** Where the `(app)` gate sends a signed-out visitor: `/login`, with `next` when it is safe. */
export function signInRedirect(requestPath: string | null): string {
  return loginPath(requestPath ?? "");
}
