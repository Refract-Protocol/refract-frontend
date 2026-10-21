"use client";

import { useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WalletProvider } from "@/lib/wallet/WalletProvider";
import { ToastProvider, useToast } from "@/components/ui/ToastProvider";
import { useFeatureFlag } from "@/lib/flags/useFeatureFlag";
import { realtimeClient } from "@/lib/realtime/client";
import { isRealtimeAllowed } from "@/lib/realtime/preferences";

export function Providers({ children }: { children: React.ReactNode }) {
  // One client per browser session. Query functions already fold failures
  // into fixture/error results, so automatic retries would only delay them.
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 } } })
  );

  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <RealtimeLifecycle />
        <WalletProvider>{children}</WalletProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}

/** Owns the one app-shell connection. All route hooks attach to this client. */
function RealtimeLifecycle() {
  const enabled = useFeatureFlag("realtime-oracle");
  const { toast } = useToast();
  const [preferenceRevision, setPreferenceRevision] = useState(0);

  useEffect(() => {
    const onPreferenceChange = () => setPreferenceRevision((revision) => revision + 1);
    window.addEventListener("refract-realtime-preference-change", onPreferenceChange);
    return () =>
      window.removeEventListener("refract-realtime-preference-change", onPreferenceChange);
  }, []);

  useEffect(() => {
    if (!enabled || !isRealtimeAllowed()) return;

    // This runs after hydration, so it cannot delay server rendering or first paint.
    realtimeClient.warm();
    const onControl = realtimeClient.subscribeControl((control) => {
      if (control.type === "revocation") {
        toast({
          title: "Live updates stopped",
          description: control.reason,
          tone: "danger",
          duration: 0,
        });
      } else if (control.type === "maintenance" || control.type === "drain") {
        toast({
          title: "Live updates paused",
          description:
            control.reason ?? "The service is restarting. Updates will resume automatically.",
          duration: 6000,
        });
      } else if (control.type === "drain-complete") {
        toast({ title: "Live updates resumed", duration: 3000 });
      }
    });

    // Warming is delegated so navigation links in the shell and route content
    // both trigger it without each link taking ownership of the socket.
    const warmOnIntent = (event: Event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const link = target.closest("a[href]");
      if (
        link &&
        ["/cover", "/provide"].includes(new URL((link as HTMLAnchorElement).href).pathname)
      )
        realtimeClient.warm();
    };
    document.addEventListener("pointerover", warmOnIntent, { passive: true });
    document.addEventListener("focusin", warmOnIntent);
    return () => {
      onControl();
      document.removeEventListener("pointerover", warmOnIntent);
      document.removeEventListener("focusin", warmOnIntent);
      realtimeClient.disconnect();
    };
  }, [enabled, preferenceRevision, toast]);

  return null;
}
