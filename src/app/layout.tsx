import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Refract — Parametric insurance on Stellar",
    template: "%s · Refract",
  },
  description:
    "Trustless, oracle-triggered parametric insurance. No claims form — automatic payout within seconds of a qualifying event.",
  metadataBase: new URL("https://refract.example"),
  icons: {
    icon: "/favicon.svg",
  },
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
      <body className="font-body">
        <a href="#main-content" className="pm-skip-link">
          Skip to main content
        </a>
        {children}
      </body>
    </html>
  );
}
