import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { Providers } from "./providers";
import WebVitals from "./web-vitals";
import { RealtimeOverrideStatus } from "@/components/RealtimeOverrideStatus";

export const metadata: Metadata = {
  title: "Refract Protocol",
  description: "Parametric insurance for digital assets and real-world events.",
};

/** App shell. Realtime startup is owned by the hydrated Providers tree. */
export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <Providers>
          {children}
          <RealtimeOverrideStatus />
          <WebVitals />
        </Providers>
      </body>
    </html>
  );
}
