import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Provide Capital",
  description:
    "Underwrite Refract's parametric insurance pool, earn premium yield on your USDC, and track your pool share price in real time.",
  openGraph: {
    title: "Provide Capital · Refract Protocol",
    description: "Deposit USDC into the Refract risk pool and earn premiums when no triggers fire.",
  },
};

export default function ProvideLayout({ children }: { children: React.ReactNode }) {
  return children;
}
