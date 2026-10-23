import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ACTIVE_NETWORK } from "@/lib/network";
import { realtimeClient } from "@/lib/realtime/client";
import { Navbar } from "./Navbar";

vi.mock("@/lib/wallet/WalletProvider", () => ({
  useWallet: () => ({ status: "connected", address: "GTESTACCOUNT" }),
  truncateAddress: (address: string) => address,
}));

afterEach(() => vi.unstubAllGlobals());

describe("Navbar account balance", () => {
  it("reflects a pushed balance without a page reload", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        sequence: "12",
        balances: [{ asset_type: "credit_alphanum4", asset_code: "USDC", asset_issuer: "GISSUER", balance: "12.5000000" }],
      }),
    }));
    render(React.createElement(Navbar));
    await waitFor(() => expect(screen.getByLabelText("Live wallet balance")).toHaveTextContent("12.50 USDC"));
    realtimeClient.dispatch(`account:${ACTIVE_NETWORK.id}:GTESTACCOUNT`, {
      balances: [{ asset: "USDC:GISSUER", balance: "11.2500000", assetType: "credit_alphanum4", decimals: 7 }],
      sequence: "13", updatedAt: Date.now(),
    });
    await waitFor(() => expect(screen.getByLabelText("Live wallet balance")).toHaveTextContent("11.25 USDC"));
  });
});
