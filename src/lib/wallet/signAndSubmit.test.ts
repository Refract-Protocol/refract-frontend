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
});
