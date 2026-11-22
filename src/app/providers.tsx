"use client";

import { useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RealtimeRouteProvider } from "@/lib/realtime/RouteProvider";
import { WalletProvider } from "@/lib/wallet/WalletProvider";
import { ToastProvider, useToast } from "@/components/ui/ToastProvider";
import { AriaLiveProvider } from "@/components/ui/AriaLiveProvider";
import { RealtimeSyncProvider } from "@/lib/realtime/RealtimeSyncProvider";
import { RealtimeScopeSync } from "@/lib/realtime/RealtimeScopeSync";
import { useFeatureFlag } from "@/lib/flags/useFeatureFlag";
import { bindRealtimeLifecycle, realtimeClient } from "@/lib/realtime";
import { isRealtimeAllowed } from "@/lib/realtime/preferences";

import { RealtimeModeGuard } from "@/lib/realtime/RealtimeModeGuard";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 } } })
  );

  useEffect(() => bindRealtimeLifecycle(realtimeClient), []);

  return (
    <QueryClientProvider client={queryClient}>
      <AriaLiveProvider>
        <RealtimeModeGuard>
          <RealtimeSyncProvider>
            <ToastProvider>
              <WalletProvider>
                <RealtimeScopeSync />
                <RealtimeRouteProvider>{children}</RealtimeRouteProvider>
              </WalletProvider>
            </ToastProvider>
          </RealtimeSyncProvider>
        </RealtimeModeGuard>
      </AriaLiveProvider>
    </QueryClientProvider>
  );
}
