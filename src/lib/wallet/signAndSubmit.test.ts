import { describe, it, expect, vi } from "vitest";
import { signAndSubmit } from "./signAndSubmit";
import * as freighterApi from "@stellar/freighter-api";
import * as txApi from "@/lib/api/tx";

vi.mock("@stellar/freighter-api");
vi.mock("@/lib/api/tx");

describe("signAndSubmit with optimistic triggers", () => {
  it("calls onSigned callback immediately after successful signing before awaiting submitSignedTx", async () => {
    const onSigned = vi.fn();

    vi.mocked(freighterApi.signTransaction).mockResolvedValue({
      signedTxXdr: "AAAA_SIGNED_XDR",
      signerAddress: "GADDR...",
    } as unknown as { signedTxXdr: string; signerAddress: string });

    vi.mocked(txApi.submitSignedTx).mockResolvedValue({
      confirmed: true,
      txHash: "TX_HASH_123",
    });

    const hash = await signAndSubmit("RAW_TX_XDR", "GADDR...", "Test SDF Network ; September 2015", onSigned);

    expect(onSigned).toHaveBeenCalledWith("AAAA_SIGNED_XDR");
    expect(hash).toBe("TX_HASH_123");
  });

  it("throws error when signing is declined without triggering onSigned", async () => {
    const onSigned = vi.fn();

    vi.mocked(freighterApi.signTransaction).mockResolvedValue({
      error: { message: "User declined signature" },
    } as unknown as { signedTxXdr: string; signerAddress: string });

    await expect(
      signAndSubmit("RAW_TX_XDR", "GADDR...", "Test SDF Network ; September 2015", onSigned)
    ).rejects.toThrow("User declined signature");

    expect(onSigned).not.toHaveBeenCalled();
  });

  it("triggers onSigned but throws when tx submission fails confirmation", async () => {
    const onSigned = vi.fn();

    vi.mocked(freighterApi.signTransaction).mockResolvedValue({
      signedTxXdr: "AAAA_SIGNED_XDR",
      signerAddress: "GADDR...",
    } as unknown as { signedTxXdr: string; signerAddress: string });

    vi.mocked(txApi.submitSignedTx).mockResolvedValue({
      confirmed: false,
      txHash: "",
      error: "Tx rejected on-chain",
    });

    await expect(
      signAndSubmit("RAW_TX_XDR", "GADDR...", "Test SDF Network ; September 2015", onSigned)
    ).rejects.toThrow("Tx rejected on-chain");

    expect(onSigned).toHaveBeenCalledWith("AAAA_SIGNED_XDR");
  });
});
