import { apiRequest } from "./client";

/** Mirrors OracleReading from refract-backend/src/oracle/oracle-reading.ts. */
export interface OracleReading {
  coverageType: string;
  type: "oracle_update";
  value: number;
  threshold: number;
  severity: "low" | "medium" | "high" | "triggered";
  message: string;
}

export function fetchOracleStatus(signal?: AbortSignal): Promise<{ readings: OracleReading[] }> {
  return apiRequest("/oracle/status", { signal });
}
