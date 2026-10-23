import type { Metadata } from "next";
import { Navbar, Footer } from "@/components/layout";
import { Container } from "@/components/ui";
import { ProtocolStatusView } from "@/components/status/ProtocolStatusView";
import { fetchProtocolStatus } from "@/lib/realtime/status";

export const metadata: Metadata = {
  title: "Status",
  description: "Current Refract Protocol status, scheduled maintenance and recent incidents.",
};

export const dynamic = "force-dynamic";

export default async function StatusPage() {
  const initial = await fetchProtocolStatus();
  return (
    <>
      <Navbar />
      <main className="py-12">
        <Container>
          <h1 className="mb-8 font-display text-3xl font-extrabold text-pm-text">
            Protocol status
          </h1>
          <ProtocolStatusView initial={initial} />
        </Container>
      </main>
      <Footer />
    </>
  );
}
