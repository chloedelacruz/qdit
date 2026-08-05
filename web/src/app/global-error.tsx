"use client";

/**
 * The last resort: this replaces the root layout, so it only ever renders when
 * the root layout itself failed. Everything shallower is caught by
 * `src/app/error.tsx`, and everything inside the shell by `(app)/error.tsx`.
 *
 * Three constraints, all from the Next.js 16 docs, all deliberate here:
 *
 *   1. It must render its own `<html>` and `<body>`, because it stands in for
 *      the root layout rather than nesting inside it.
 *   2. Global styles do not reach it and neither does the app's theme class,
 *      which `next-themes` sets on `<html>` in a layout that, by definition,
 *      did not render. So the styling is inline and the dark variant comes from
 *      `prefers-color-scheme` instead — the OS is the only signal still
 *      available. Inline also means this survives the CSS pipeline itself being
 *      the thing that broke, which is exactly the failure that gets here.
 *   3. `metadata` is not supported in a Client Component, so the tab title is
 *      React's `<title>` element.
 *
 * The colours are the light/dark surface tokens from `globals.css`, written out
 * literally because the custom properties that define them are unavailable.
 */
export default function GlobalError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "1.5rem",
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
          fontSize: "13px",
          lineHeight: 1.5,
          background: "var(--qdit-bg)",
          color: "var(--qdit-fg)",
        }}
      >
        <title>Something went wrong — qdit</title>

        <style>{`
          :root {
            --qdit-bg: #ffffff;
            --qdit-fg: #0a0a0a;
            --qdit-muted: #737373;
            --qdit-border: #e5e5e5;
            --qdit-accent: #171717;
            --qdit-accent-fg: #fafafa;
          }
          @media (prefers-color-scheme: dark) {
            :root {
              --qdit-bg: #0a0a0a;
              --qdit-fg: #fafafa;
              --qdit-muted: #a1a1a1;
              --qdit-border: #262626;
              --qdit-accent: #fafafa;
              --qdit-accent-fg: #171717;
            }
          }
        `}</style>

        <main
          style={{
            width: "100%",
            maxWidth: "28rem",
            textAlign: "center",
            border: "1px dashed var(--qdit-border)",
            borderRadius: "0.75rem",
            padding: "4rem 1.5rem",
          }}
        >
          <h1 style={{ fontSize: "0.875rem", fontWeight: 600, margin: 0 }}>
            qdit could not start
          </h1>

          <p
            style={{
              margin: "0.375rem auto 0",
              maxWidth: "24rem",
              color: "var(--qdit-muted)",
            }}
          >
            Something failed before the app could render. This is usually
            temporary — reloading is the first thing to try.
          </p>

          <button
            type="button"
            onClick={() => unstable_retry()}
            style={{
              marginTop: "1.25rem",
              cursor: "pointer",
              borderRadius: "0.5rem",
              border: "1px solid transparent",
              background: "var(--qdit-accent)",
              color: "var(--qdit-accent-fg)",
              padding: "0.375rem 0.75rem",
              font: "inherit",
              fontWeight: 500,
            }}
          >
            Try again
          </button>

          {/* The only handle anyone has on the corresponding server-side log. */}
          {error.digest ? (
            <p
              style={{
                marginTop: "1.25rem",
                marginBottom: 0,
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                fontSize: "0.75rem",
                color: "var(--qdit-muted)",
              }}
            >
              Reference {error.digest}
            </p>
          ) : null}
        </main>
      </body>
    </html>
  );
}
