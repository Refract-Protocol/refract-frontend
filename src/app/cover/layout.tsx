import { Suspense } from "react";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Get Coverage",
  description:
    "Buy oracle-triggered parametric coverage on Refract — stablecoin depeg, market crash, liquidation, smart contract risk, and flight delay policies. No claims form, automatic payout.",
  openGraph: {
    title: "Get Coverage · Refract Protocol",
    description:
      "Choose a coverage type, set amount and duration, pay premium once. Payout is automatic.",
  },
};

export default function CoverLayout({ children }: { children: React.ReactNode }) {
  // The cover page reads its form state from the URL (useSearchParams), which
  // needs a Suspense boundary to prerender.
  return <Suspense>{children}</Suspense>;
}
