import { apiRequest } from "./client";
import type { OracleReading } from "@/lib/realtime/generated/schemas";

/** Types are generated from openapi/refract-api.yaml, which mirrors OracleReading from refract-backend/src/oracle/oracle-reading.ts. */
export type { OracleReading };

export function fetchOracleStatus(signal?: AbortSignal): Promise<{ readings: OracleReading[] }> {
  return apiRequest("/oracle/status", { signal });
}
