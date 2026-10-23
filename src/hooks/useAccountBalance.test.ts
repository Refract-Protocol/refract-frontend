import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ACTIVE_NETWORK } from "@/lib/network";
import { realtimeClient } from "@/lib/realtime/client";
import { useAccountBalance } from "./useAccountBalance";

const ADDRESS = "GTESTACCOUNT";
const accountResponse = (balance: string, sequence = "12") => ({
  balances: [{ asset_type: "credit_alphanum4", asset_code: "USDC", asset_issuer: "GISSUER", balance }],
  sequence,
});

afterEach(() => vi.unstubAllGlobals());

describe("useAccountBalance", () => {
  it("starts from Horizon and applies authoritative account pushes", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => accountResponse("12.5000000") });
    vi.stubGlobal("fetch", fetch);
    const { result } = renderHook(() => useAccountBalance(ADDRESS));
    await waitFor(() => expect(result.current.balances[0]?.balance).toBe("12.5000000"));

    act(() => realtimeClient.dispatch(`account:${ACTIVE_NETWORK.id}:${ADDRESS}`, {
      balances: [{ asset: "USDC:GISSUER", balance: "11.2500000", assetType: "credit_alphanum4", decimals: 7 }],
      sequence: "13", updatedAt: Date.now(),
    }));
    await waitFor(() => expect(result.current.sequence).toBe("13"));
    expect(result.current.balances[0].balance).toBe("11.2500000");
    expect(result.current.isStale).toBe(false);
  });

  it("treats an unfunded account as an empty account without an error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 404, ok: false }));
    const { result } = renderHook(() => useAccountBalance(ADDRESS));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.balances).toEqual([]);
    expect(result.current.sequence).toBe("0");
  });

  it("keeps a network failure in loading fallback state without throwing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const { result } = renderHook(() => useAccountBalance(ADDRESS));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.balances).toEqual([]);
    expect(result.current.isStale).toBe(true);
  });
});
