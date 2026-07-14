"use client";

// Root-level error boundary — only fires if the root layout itself throws.
// Must render its own <html>/<body> since it replaces the whole tree.
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body
        style={{
          background: "#07050f",
          color: "#ede9f8",
          fontFamily: "system-ui, sans-serif",
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          padding: 24,
        }}
      >
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, marginBottom: 8 }}>Refract failed to load</h1>
          <p style={{ color: "rgba(237,233,248,0.5)", fontSize: 14, marginBottom: 20 }}>
            A critical UI error occurred. No funds or on-chain state are affected.
          </p>
          <button
            onClick={() => reset()}
            style={{
              background: "#8b5cf6",
              color: "#fff",
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
        </div>
      </body>
    </html>
  );
}
