import type { Metadata, Viewport } from "next";
import { Analytics } from "@vercel/analytics/next";
import { Geist, Geist_Mono } from "next/font/google";

import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { qditUrl } from "@/lib/api/resources";

import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const TITLE = "qdit — builder operations for Stellar teams";
const DESCRIPTION =
  "Track tasks, milestones and Soroban deployments in one place — with contract IDs, transaction hashes and proof of work attached to every milestone.";

/**
 * `metadataBase` makes the generated `opengraph-image` URL absolute, which
 * link previews need. The Open Graph and Twitter blocks here are the defaults
 * every page shares; a page that sets its own `openGraph` replaces this one
 * whole (Next merges metadata shallowly), so it must restate what it keeps.
 */
export const metadata: Metadata = {
  metadataBase: new URL(qditUrl("/")),
  title: {
    default: TITLE,
    template: "%s · qdit",
  },
  description: DESCRIPTION,
  applicationName: "qdit",
  openGraph: {
    type: "website",
    siteName: "qdit",
    title: TITLE,
    description: DESCRIPTION,
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
  },
};

export const viewport: Viewport = {
  // Lets the mobile tab bar pad itself clear of the home indicator with
  // env(safe-area-inset-bottom) instead of sitting under it.
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F8FAFC" },
    { media: "(prefers-color-scheme: dark)", color: "#0F172A" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <TooltipProvider>{children}</TooltipProvider>
          {/* Lifted clear of the mobile tab bar; on a desktop there is none. */}
          <Toaster position="bottom-right" mobileOffset={{ bottom: "calc(4.5rem + env(safe-area-inset-bottom))" }} />
          {/*
            Page views only, and no cookie: @vercel/analytics identifies a
            visit with a hash that is not stored on the device, so this needs no
            consent banner and cannot follow anyone between sites.

            Here rather than in the app layout on purpose — the pages that
            matter most for measuring onboarding are the ones outside it: the
            landing page, /login, and the public proof pages that a signed-out
            visitor opens from a link somebody sent them.
          */}
          <Analytics />
        </ThemeProvider>
      </body>
    </html>
  );
}
