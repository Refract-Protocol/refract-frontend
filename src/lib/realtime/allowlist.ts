import { API_BASE_URL } from "../api/client";
import { endpointFromApiBase } from "./endpointConfig";

export type RealtimeEndpoint = {
  url: string;
  origin: string;
  websocketOrigin: string;
  sseOrigin: string;
};

export function resolveRealtimeEndpoint(apiBaseUrl: string): RealtimeEndpoint {
  const config = endpointFromApiBase(apiBaseUrl);
  return {
    url: config.url,
    origin: config.apiOrigin,
    websocketOrigin: config.websocketOrigin,
    sseOrigin: config.apiOrigin,
  };
}

export const REALTIME_ENDPOINT = resolveRealtimeEndpoint(API_BASE_URL);

export function isAllowedRealtimeUrl(
  url: string,
  endpoint: RealtimeEndpoint = REALTIME_ENDPOINT
): boolean {
  try {
    const candidate = new URL(url);
    return (
      candidate.origin === endpoint.websocketOrigin &&
      candidate.protocol === (endpoint.websocketOrigin.startsWith("wss:") ? "wss:" : "ws:")
    );
  } catch {
    return false;
  }
}

export function buildRealtimeCsp(endpoint: RealtimeEndpoint): string {
  return `default-src 'self'; connect-src 'self' ${endpoint.websocketOrigin} ${endpoint.sseOrigin}`;
}
