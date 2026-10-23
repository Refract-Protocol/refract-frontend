import { apiRequest } from "./client";
import type { OracleReading } from "@/lib/domain/realtime";

/** Types are generated from openapi/refract-api.yaml, which mirrors OracleReading from refract-backend/src/oracle/oracle-reading.ts. */
export type { OracleReading } from "@/lib/domain/realtime";

export function fetchOracleStatus(signal?: AbortSignal): Promise<{ readings: OracleReading[] }> {
  return apiRequest("/oracle/status", { signal });
}
