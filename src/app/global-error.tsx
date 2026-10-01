"use client";

import { criticalStyles as t } from "@/lib/criticalStyles";

// Root-level error boundary — only fires if the root layout itself throws.
// Must render its own <html>/<body> since it replaces the whole tree, and it
// cannot depend on globals.css or the components/ui primitives being loaded.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <head>
        <style
          // Minimum critical CSS: focus visibility (globals.css is unavailable
          // here) and a reduced-motion-aware entrance animation.
          dangerouslySetInnerHTML={{
            __html: `
              .ge-root { box-sizing: border-box; }
              .ge-root *, .ge-root *::before, .ge-root *::after { box-sizing: inherit; }
              .ge-btn:focus-visible, .ge-link:focus-visible {
                outline: 2px solid ${t.accent};
                outline-offset: 2px;
                border-radius: 8px;
              }
              @keyframes ge-fade-in {
                from { opacity: 0; transform: translateY(6px); }
                to { opacity: 1; transform: translateY(0); }
              }
              .ge-panel { animation: ge-fade-in 240ms ease-out both; }
              @media (prefers-reduced-motion: reduce) {
                .ge-panel { animation: none; }
              }
            `,
          }}
        />
      </head>
      <body
        className="ge-root"
        style={{
          background: t.background,
          color: t.foreground,
          fontFamily: t.fontFamily,
          minHeight: "100vh",
          margin: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          padding: 24,
        }}
      >
        <div
          className="ge-panel"
          style={{
            maxWidth: 420,
            width: "100%",
            background: t.panel,
            border: `1px solid ${t.border}`,
            borderRadius: 16,
            padding: "32px 24px",
          }}
        >
          <div
            aria-hidden="true"
            style={{
              width: 56,
              height: 56,
              margin: "0 auto 20px",
              borderRadius: "50%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: t.accent,
              color: t.accentForeground,
              fontSize: 26,
              fontWeight: 800,
              lineHeight: 1,
            }}
          >
            R
          </div>
          <h1 style={{ fontSize: 22, fontWeight: 800, margin: "0 0 8px" }}>
            Refract failed to load
          </h1>
          <p style={{ color: t.muted, fontSize: 14, margin: "0 0 20px", lineHeight: 1.5 }}>
            A critical UI error occurred. No funds or on-chain state are affected.
          </p>
          {error?.digest ? (
            <p
              style={{
                color: t.muted,
                fontSize: 12,
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                margin: "0 0 20px",
                wordBreak: "break-all",
              }}
            >
              Reference: {error.digest}
            </p>
          ) : null}
          <div
            style={{
              display: "flex",
              gap: 12,
              justifyContent: "center",
              flexWrap: "wrap",
            }}
          >
            <button
              type="button"
              className="ge-btn"
              onClick={() => reset()}
              style={{
                background: t.accent,
                color: t.accentForeground,
                border: "none",
                borderRadius: 8,
                padding: "10px 20px",
                fontSize: 14,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Try again
            </button>
            <a
              href="/"
              className="ge-link"
              style={{
                display: "inline-flex",
                alignItems: "center",
                background: "transparent",
                color: t.foreground,
                border: `1px solid ${t.border}`,
                borderRadius: 8,
                padding: "10px 20px",
                fontSize: 14,
                fontWeight: 600,
                textDecoration: "none",
              }}
            >
              Back home
            </a>
          </div>
        </div>
      </body>
    </html>
  );
}
