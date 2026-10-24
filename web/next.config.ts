import type { NextConfig } from "next";

/**
 * Pages that must never render inside another site's frame.
 *
 * /oauth/consent is where a qdit user grants another app access, and a page
 * that can be framed can be clickjacked — an invisible iframe over a decoy
 * button, and the user's click lands on Allow (RFC 6749 §10.13). /login and
 * /register sit on the way to it and take credentials, so they get the same.
 * Both headers: frame-ancestors is the standard, X-Frame-Options covers
 * browsers that predate it.
 */
const NO_FRAMING = [
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Frame-Options", value: "DENY" },
];

const nextConfig: NextConfig = {
  async headers() {
    return ["/oauth/:path*", "/login", "/register"].map((source) => ({
      source,
      headers: NO_FRAMING,
    }));
  },
};

export default nextConfig;
