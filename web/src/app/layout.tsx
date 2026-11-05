import type { Metadata, Viewport } from "next";
import { Analytics } from "@vercel/analytics/next";
import { Geist, Geist_Mono } from "next/font/google";

import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "qdit — builder operations for Stellar teams",
    template: "%s · qdit",
  },
  description:
    "Track tasks, milestones and Soroban deployments in one place — with contract IDs, transaction hashes and proof of work attached to every milestone.",
  applicationName: "qdit",
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
