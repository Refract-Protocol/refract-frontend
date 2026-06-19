import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Refract — Parametric insurance on Stellar",
  description:
    "Trustless, oracle-triggered parametric insurance. No claims form — automatic payout within seconds of a qualifying event.",
  metadataBase: new URL("https://refract.example"),
  openGraph: {
    title: "Refract Protocol",
    description: "Oracle-triggered parametric insurance on Stellar/Soroban.",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#07050f",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="font-body">{children}</body>
    </html>
  );
}
