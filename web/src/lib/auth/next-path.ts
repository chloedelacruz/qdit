/**
 * Where to send someone after they sign in, when the URL asked for somewhere.
 *
 * Sign-in now has a caller that is not qdit: doqtri sends a user to
 * /oauth/consent, which bounces a signed-out visitor to
 * `/login?next=/oauth/consent?authorization_id=…`, and every sign-in path has
 * to carry that `next` through and land on it. A `next` that can point
 * anywhere is an open redirect — a crafted link that signs someone in on the
 * real qdit and then hands them, freshly authenticated and trusting the page,
 * to an attacker's copy of it. So the value is only ever a path on this
 * origin.
 *
 * "Starts with `/`" is not enough, which is why this is a module and not a
 * one-line check in each caller:
 *
 *   //evil.example         protocol-relative: another host
 *   /\evil.example         browsers read `\` as `/`, so the same thing
 *   /<TAB>/evil.example    the URL parser strips tabs and newlines first
 *
 * The test that holds is the one a browser would apply: resolve the value
 * against a fixed origin and keep it only if the origin did not change. What
 * comes back is the *resolved* path, not the input, so the string the caller
 * redirects to is the one that was checked.
 */

export const DEFAULT_NEXT_PATH = "/dashboard";

/** Longer than any real path here; stops a `next` being used as a payload. */
const MAX_LENGTH = 2048;

/** Only used to resolve against. Never fetched, never rendered. */
const BASE = "http://qdit.invalid";

/**
 * A same-origin path (with its query and hash) to redirect to, or `fallback`.
 *
 * Accepts `unknown` because its inputs are `searchParams` values and form
 * fields, which can be missing, repeated (`string[]`) or a `File`.
 */
export function safeNextPath(value: unknown, fallback: string = DEFAULT_NEXT_PATH): string {
  if (typeof value !== "string") return fallback;
  if (value.length === 0 || value.length > MAX_LENGTH) return fallback;

  // Must already look like a path. Rejecting before parsing keeps relative
  // values (`dashboard`, `../x`) and absolute URLs out, whatever they resolve to.
  if (!value.startsWith("/")) return fallback;

  // Backslashes and control characters (tab, newline and the rest) are what
  // the URL parser rewrites or drops before it decides which host it is
  // looking at. Nothing legitimate here contains them, so refuse rather than
  // reason about what they turn into.
  // eslint-disable-next-line no-control-regex
  if (/[\\\u0000-\u001f\u007f]/.test(value)) return fallback;

  let url: URL;
  try {
    url = new URL(value, BASE);
  } catch {
    return fallback;
  }

  if (url.origin !== BASE) return fallback;

  const path = `${url.pathname}${url.search}${url.hash}`;

  // Belt and braces: a resolved path that still opens with `//` would be read
  // as protocol-relative by whatever redirects to it.
  if (path.startsWith("//")) return fallback;

  return path;
}

/** `/login`, carrying `next` when it is worth carrying. */
export function loginPath(next: string): string {
  return withNext("/login", next);
}

/**
 * `/register`, carrying `next`. A wallet with no account goes there instead of
 * landing anywhere, and someone who arrived from another app's consent link
 * has to come out of registration where they were going.
 */
export function registerPath(next: string): string {
  return withNext("/register", next);
}

function withNext(path: string, next: string): string {
  const safe = safeNextPath(next);
  return safe === DEFAULT_NEXT_PATH ? path : `${path}?next=${encodeURIComponent(safe)}`;
}
