import { apiRequest } from "./client";
import type { ApiSchemas } from "./generated";

/** Types are generated from openapi/refract-api.yaml, which mirrors OracleReading from refract-backend/src/oracle/oracle-reading.ts. */
export type OracleReading = ApiSchemas["OracleReading"];

export function fetchOracleStatus(signal?: AbortSignal): Promise<{ readings: OracleReading[] }> {
  return apiRequest("/oracle/status", { signal });
}
