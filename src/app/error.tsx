"use client";

import { useEffect } from "react";
import { Navbar, Footer } from "@/components/layout";
import { Container, Card, Button } from "@/components/ui";

export default function ErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error("Refract UI error boundary caught:", error);
  }, [error]);

  return (
    <div className="min-h-screen bg-pm-bg">
      <Navbar />
      <main id="main-content">
        <Container className="flex min-h-[70vh] items-center justify-center py-16">
          <Card padding="lg" className="flex max-w-md flex-col items-center gap-4 text-center" role="alert">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-pm-red/10 text-2xl" aria-hidden="true">
              ⚠️
            </div>
            <div>
              <h1 className="mb-2 font-display text-2xl font-extrabold tracking-tight text-pm-text">
                Something went wrong
              </h1>
              <p className="text-sm text-pm-text/50">
                This is a client-side error in the UI — no funds or on-chain state are affected. You can try again.
              </p>
              {error.digest && <p className="mt-2 font-mono text-[11px] text-pm-text/30">Ref: {error.digest}</p>}
            </div>
            <div className="mt-2 flex flex-col gap-2.5 xs:flex-row">
              <Button type="button" variant="primary" onClick={() => reset()}>Try again</Button>
              <Button href="/" variant="ghost">Back to home</Button>
            </div>
          </Card>
        </Container>
      </main>
      <Footer />
    </div>
  );
}
