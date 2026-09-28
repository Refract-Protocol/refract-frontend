import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  RESOURCE_FEE_ESTIMATE_STROOPS,
  estimateFeeStroops,
  fetchInclusionFee,
  formatFeeXlm,
  resetFeeStatsCache,
} from "./fees";

describe("estimateFeeStroops / formatFeeXlm", () => {
  it.each([
    ["buy", 100, 150_100, "~0.0150 XLM"],
    ["provide", 1_000, 121_000, "~0.0121 XLM"],
    ["withdraw", 50_000, 170_000, "~0.0170 XLM"],
  ] as const)("%s at base fee %d", (kind, base, stroops, label) => {
    expect(estimateFeeStroops(kind, base)).toBe(stroops);
    expect(formatFeeXlm(stroops)).toBe(label);
  });

  it("has a resource estimate for every tx kind", () => {
    expect(Object.keys(RESOURCE_FEE_ESTIMATE_STROOPS).sort()).toEqual(["buy", "provide", "withdraw"]);
  });
});

describe("fetchInclusionFee", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    resetFeeStatsCache();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  const ok = (body: unknown) => ({ ok: true, json: async () => body });

  it("uses the median fee charged and caches it for 60s", async () => {
    fetchMock.mockResolvedValue(ok({ fee_charged: { p50: "250" }, last_ledger_base_fee: "100" }));
    expect(await fetchInclusionFee(0)).toBe(250);
    expect(await fetchInclusionFee(59_999)).toBe(250);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await fetchInclusionFee(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("falls back to the last ledger base fee", async () => {
    fetchMock.mockResolvedValue(ok({ last_ledger_base_fee: "100" }));
    expect(await fetchInclusionFee(0)).toBe(100);
  });

  it("returns null when the request throws", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    expect(await fetchInclusionFee(0)).toBeNull();
  });

  it("returns null on a non-OK response", async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({}) });
    expect(await fetchInclusionFee(0)).toBeNull();
  });

  it("returns null on an unusable payload", async () => {
    fetchMock.mockResolvedValue(ok({ fee_charged: { p50: "nope" } }));
    expect(await fetchInclusionFee(0)).toBeNull();
  });
});
