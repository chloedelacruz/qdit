/**
 * The host a plan doc's link goes to, as the row shows it.
 *
 * `doc_url` is whatever https URL the linking admin (or the doqtri app acting
 * for them) sent; the contract does not pin it to doqtri's origin. So the
 * "Plan docs" row names the host it will open rather than promising doqtri.
 * `URL` gives the punycode form of an internationalised host, which is the
 * honest one to show: a look-alike domain reads as `xn--...`, not as doqtri.
 */
export function docUrlHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    // The table's CHECK makes this unreachable; show nothing rather than throw.
    return "";
  }
}
