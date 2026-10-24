/**
 * The host a plan doc's link goes to, as the row shows it.
 *
 * The row links only a `doc_url` on doqtri's origin (D-45, see
 * `isDoqtriDocUrl`), and still names the host it opens, so the text and the
 * link cannot disagree. `URL` gives the punycode form of an internationalised
 * host, which is the honest one to show: a look-alike reads as `xn--...`.
 */
export function docUrlHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    // The table's CHECK makes this unreachable; show nothing rather than throw.
    return "";
  }
}
