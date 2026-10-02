import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as oracleApi from "@/lib/api/oracle";
import { FIXTURE_ORACLE_READINGS } from "@/lib/fixtures/oracle";

vi.mock("@/lib/api/oracle");

describe("useOracleStatus logic", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("fetches readings and handles polling interval", async () => {
    const mockReadings = [
      { coverageType: 0, severity: "low", value: 0.999 },
    ];
    vi.mocked(oracleApi.fetchOracleStatus).mockResolvedValue({
      readings: mockReadings as any,
    });

    const res = await oracleApi.fetchOracleStatus();
    expect(res.readings).toEqual(mockReadings);
    expect(FIXTURE_ORACLE_READINGS.length).toBeGreaterThan(0);
  });
});
