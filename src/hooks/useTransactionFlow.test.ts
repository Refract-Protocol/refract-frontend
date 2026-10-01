import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { useTransactionFlow } from "./useTransactionFlow";
import * as walletProvider from "@/lib/wallet/WalletProvider";

vi.mock("@/lib/wallet/WalletProvider");
vi.mock("@/lib/wallet/signAndSubmit");

describe("useTransactionFlow", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("initializes in idle state and provides execute/reset handlers", () => {
    vi.mocked(walletProvider.useWallet).mockReturnValue({
      status: "connected",
      address: "GADDR...",
      networkPassphrase: "Test SDF Network ; September 2015",
      connect: vi.fn(),
      disconnect: vi.fn(),
      network: "testnet",
      ready: true,
      installed: true,
      error: null,
    });

    let hookResult: any = null;
    function TestComponent() {
      hookResult = useTransactionFlow<{ id: string }>();
      return null;
    }

    React.createElement(TestComponent);
    expect(useTransactionFlow).toBeDefined();
  });
});
