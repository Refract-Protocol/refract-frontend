import { apiRequest } from "@/lib/api/client";
import { ACTIVE_NETWORK } from "@/lib/network";
import type { ProtocolStatus } from "./topics";

/** REST snapshot; falls back to "unknown" so the page is useful with the backend (or realtime) down. */
export async function fetchProtocolStatus(): Promise<ProtocolStatus> {
  try {
    const status = await apiRequest<ProtocolStatus>("/status");
    return { ...status, network: status.network ?? ACTIVE_NETWORK.id };
  } catch {
    return { level: "unknown", updatedAt: new Date().toISOString(), network: ACTIVE_NETWORK.id };
  }
}
