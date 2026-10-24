import type { NextConfig } from "next";

/**
 * No qdit response may render inside another site's frame (D-33).
 *
 * /oauth/consent is where a qdit user grants another app access, and a page
 * that can be framed can be clickjacked — an invisible iframe over a decoy
 * button, and the user's click lands on Allow (RFC 6749 §10.13). The same
 * trick works on any page with a button that matters: approving a milestone,
 * inviting a member, signing a transaction. So it is the whole app, not a list
 * of routes that would need to grow every time one is added, and no page here
 * is meant to be embedded anywhere.
 *
 * Both headers: frame-ancestors is the standard, X-Frame-Options covers
 * browsers that predate it. `/:path*` matches `/` as well as every path below
 * it, API routes and static files included; src/lib/next-config.test.ts
 * checks that against Next's own route compiler.
 */
const NO_FRAMING = [
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Frame-Options", value: "DENY" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: NO_FRAMING }];
  },
};

export default nextConfig;
