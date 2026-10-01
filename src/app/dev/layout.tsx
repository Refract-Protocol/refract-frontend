import { notFound } from "next/navigation";
import type { ReactNode } from "react";

/**
 * Dev-only layout for the component gallery.
 *
 * The gallery is gated behind `NEXT_PUBLIC_ENABLE_UI_GALLERY` so it is never
 * reachable in production builds. When the flag is off every `/dev/*` route
 * resolves to a 404 via `notFound()`, keeping the surface out of the shipped
 * app without pulling in any page-level state or providers.
 */
export default function DevLayout({ children }: { children: ReactNode }) {
  if (process.env.NEXT_PUBLIC_ENABLE_UI_GALLERY !== "true") {
    notFound();
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto w-full max-w-6xl px-4 py-8">{children}</div>
    </div>
  );
}
