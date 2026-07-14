import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Dashboard",
  description: "Track your active Refract policies, claim status, and payout history.",
};

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return children;
}
