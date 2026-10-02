import type { Metadata } from "next";
import { Navbar, Footer } from "@/components/layout";
import { Container, Card, Badge } from "@/components/ui";
import { CONTRACTS, NETWORK_LABEL, STELLAR_NETWORK } from "@/lib/network";
import { stellarExpertContractUrl } from "@/lib/stellar";

export const metadata: Metadata = {
  title: "Contracts",
  description: "The on-chain Soroban contracts Refract Protocol interacts with, linked for independent verification.",
};

export default function TransparencyPage() {
  return (
    <>
      <Navbar />
      <main className="py-12">
        <Container>
          <div className="mb-8 flex flex-wrap items-center gap-3">
            <h1 className="font-display text-3xl font-extrabold text-pm-text">Contracts</h1>
            <Badge>{NETWORK_LABEL[STELLAR_NETWORK]}</Badge>
          </div>
          <p className="mb-8 max-w-2xl text-sm text-pm-text/50">
            Every transaction you sign on Refract interacts with the contracts below on {NETWORK_LABEL[STELLAR_NETWORK]}.
            Open any address on stellar.expert to verify it independently.
          </p>
          <div className="flex flex-col gap-4">
            {CONTRACTS.map((c) => (
              <Card key={c.name}>
                <h2 className="mb-1 text-base font-semibold text-pm-text">{c.name}</h2>
                <p className="mb-3 text-[13px] text-pm-text/45">{c.description}</p>
                {c.address ? (
                  <a
                    href={stellarExpertContractUrl(c.address)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="break-all font-mono text-xs text-pm-violet hover:underline"
                  >
                    {c.address}
                    <span className="sr-only"> (view on stellar.expert, opens in a new tab)</span>
                  </a>
                ) : (
                  <span className="text-xs text-pm-text/30">Not configured for this environment</span>
                )}
              </Card>
            ))}
          </div>
        </Container>
      </main>
      <Footer />
    </>
  );
}
