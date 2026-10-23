"use client";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/api/client";
import { realtimeClient } from "./client";
import { RouteSubscriptions } from "./routes";

const SNAPSHOTS: Record<string, string> = {
  oracle_update: "/oracle/status",
  pool_update: "/pool/stats",
  claim_update: "/claims/recent",
};
export function RealtimeRouteProvider({
  children,
  prefetchOnIntent = false,
}: {
  children: React.ReactNode;
  prefetchOnIntent?: boolean;
}) {
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const [routes] = useState(
    () =>
      new RouteSubscriptions(realtimeClient, (topic) =>
        queryClient.fetchQuery({
          queryKey: ["realtime-snapshot", topic],
          queryFn: async () => {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 5000);
            try {
              return await apiRequest(SNAPSHOTS[topic]!, { signal: controller.signal });
            } finally {
              clearTimeout(timer);
            }
          },
          staleTime: 30_000,
        })
      )
  );
  useEffect(() => {
    routes.navigate(pathname ?? "");
  }, [routes, pathname]);
  useEffect(() => () => routes.dispose(), [routes]);
  useEffect(() => {
    if (!prefetchOnIntent) return;
    const intent = (event: Event) => {
      const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (
        !(anchor instanceof HTMLAnchorElement) ||
        anchor.hasAttribute("download") ||
        anchor.target === "_blank"
      )
        return;
      const url = new URL(anchor.href);
      if (url.origin === window.location.origin) routes.prefetch(url.pathname);
    };
    document.addEventListener("pointerover", intent);
    document.addEventListener("focusin", intent);
    return () => {
      document.removeEventListener("pointerover", intent);
      document.removeEventListener("focusin", intent);
    };
  }, [routes, prefetchOnIntent]);
  return children;
}
