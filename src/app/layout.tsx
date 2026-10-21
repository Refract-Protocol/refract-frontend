import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "Refract Protocol",
  description: "Parametric coverage powered by live on-chain oracles.",
};

/** App shell. Realtime startup is owned by the hydrated Providers tree. */
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
