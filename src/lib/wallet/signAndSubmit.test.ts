import { describe, it, expect, vi, beforeEach } from "vitest";
import { signTransaction } from "@stellar/freighter-api";
import { submitSignedTx } from "@/lib/api/tx";
import { signAndSubmit } from "./signAndSubmit";

vi.mock("@stellar/freighter-api", () => ({
  signTransaction: vi.fn(),
}));

vi.mock("@/lib/api/tx", () => ({
  submitSignedTx: vi.fn(),
}));

const mockSign = vi.mocked(signTransaction);
const mockSubmit = vi.mocked(submitSignedTx);

const XDR = "unsigned-xdr";
const ADDRESS = "GADDRESS";
const PASSPHRASE = "Test SDF Network ; September 2015";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("signAndSubmit", () => {
  it("returns the tx hash on the success path", async () => {
    mockSign.mockResolvedValue({ signedTxXdr: "signed-xdr" } as never);
    mockSubmit.mockResolvedValue({ confirmed: true, txHash: "abc123" } as never);

    await expect(signAndSubmit(XDR, ADDRESS, PASSPHRASE)).resolves.toBe("abc123");
    expect(mockSign).toHaveBeenCalledWith(XDR, { networkPassphrase: PASSPHRASE, address: ADDRESS });
    expect(mockSubmit).toHaveBeenCalledWith("signed-xdr");
  });

  it("throws when the user declines to sign", async () => {
    mockSign.mockResolvedValue({ error: { message: "User declined" } } as never);

    await expect(signAndSubmit(XDR, ADDRESS, PASSPHRASE)).rejects.toThrow("User declined");
    expect(mockSubmit).not.toHaveBeenCalled();
  });

  it("throws a default message when signing yields no signed xdr", async () => {
    mockSign.mockResolvedValue({} as never);

    await expect(signAndSubmit(XDR, ADDRESS, PASSPHRASE)).rejects.toThrow(
      "Transaction signing was declined",
    );
    expect(mockSubmit).not.toHaveBeenCalled();
  });

  it("throws when the signed tx does not confirm", async () => {
    mockSign.mockResolvedValue({ signedTxXdr: "signed-xdr" } as never);
    mockSubmit.mockResolvedValue({ confirmed: false, error: "Not confirmed" } as never);

    await expect(signAndSubmit(XDR, ADDRESS, PASSPHRASE)).rejects.toThrow("Not confirmed");
  });

  it("throws a default message when unconfirmed without an error", async () => {
    mockSign.mockResolvedValue({ signedTxXdr: "signed-xdr" } as never);
    mockSubmit.mockResolvedValue({ confirmed: false } as never);

    await expect(signAndSubmit(XDR, ADDRESS, PASSPHRASE)).rejects.toThrow(
      "Transaction did not confirm on-chain",
    );
  });

  it("propagates errors thrown by submitSignedTx", async () => {
    mockSign.mockResolvedValue({ signedTxXdr: "signed-xdr" } as never);
    mockSubmit.mockRejectedValue(new Error("network down"));

    await expect(signAndSubmit(XDR, ADDRESS, PASSPHRASE)).rejects.toThrow("network down");
  });

  it("calls onSigned callback immediately after successful signing before awaiting submitSignedTx", async () => {
    const onSigned = vi.fn();

    mockSign.mockResolvedValue({ signedTxXdr: "AAAA_SIGNED_XDR" } as never);
    mockSubmit.mockResolvedValue({ confirmed: true, txHash: "TX_HASH_123" } as never);

    const hash = await signAndSubmit(XDR, ADDRESS, PASSPHRASE, onSigned);

    expect(onSigned).toHaveBeenCalledWith("AAAA_SIGNED_XDR");
    expect(hash).toBe("TX_HASH_123");
  });

  it("throws error when signing is declined without triggering onSigned", async () => {
    const onSigned = vi.fn();

    mockSign.mockResolvedValue({ error: { message: "User declined signature" } } as never);

    await expect(signAndSubmit(XDR, ADDRESS, PASSPHRASE, onSigned)).rejects.toThrow(
      "User declined signature",
    );

    expect(onSigned).not.toHaveBeenCalled();
  });

  it("triggers onSigned but throws when tx submission fails confirmation", async () => {
    const onSigned = vi.fn();

    mockSign.mockResolvedValue({ signedTxXdr: "AAAA_SIGNED_XDR" } as never);
    mockSubmit.mockResolvedValue({ confirmed: false, txHash: "", error: "Tx rejected on-chain" } as never);

    await expect(signAndSubmit(XDR, ADDRESS, PASSPHRASE, onSigned)).rejects.toThrow(
      "Tx rejected on-chain",
    );

    expect(onSigned).toHaveBeenCalledWith("AAAA_SIGNED_XDR");
  });
});
