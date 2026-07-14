import type { Metadata } from "next";
import { Navbar, Footer } from "@/components/layout";
import { Container, Card, Button } from "@/components/ui";

export const metadata: Metadata = {
  title: "Page not found",
};

export default function NotFound() {
  return (
    <div className="min-h-screen bg-pm-bg">
      <Navbar />
      <main id="main-content">
        <Container className="flex min-h-[70vh] items-center justify-center py-16">
          <Card padding="lg" className="flex max-w-md flex-col items-center gap-4 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-pm-violet/10 text-2xl" aria-hidden="true">
              🧭
            </div>
            <div>
              <h1 className="mb-2 font-display text-2xl font-extrabold tracking-tight text-pm-text">
                404 — Page not found
              </h1>
              <p className="text-sm text-pm-text/50">
                That page doesn&apos;t exist, or the trigger condition for finding it was never met.
              </p>
            </div>
            <div className="mt-2 flex flex-col gap-2.5 xs:flex-row">
              <Button href="/" variant="primary">Back to home</Button>
              <Button href="/cover" variant="ghost">Browse coverage</Button>
            </div>
          </Card>
        </Container>
      </main>
      <Footer />
    </div>
  );
}
