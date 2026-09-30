import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, ApiUnreachableError } from "@/lib/api/client";

vi.mock("@stellar/freighter-api", () => ({ signTransaction: vi.fn() }));
vi.mock("@/lib/api/tx", () => ({ submitSignedTx: vi.fn() }));

const { signTransaction } = await import("@stellar/freighter-api");
const { submitSignedTx } = await import("@/lib/api/tx");
const { signAndSubmit } = await import("./signAndSubmit");

const sign = vi.mocked(signTransaction);
const submit = vi.mocked(submitSignedTx);
const confirmed = { confirmed: true, txHash: "HASH" };

describe("signAndSubmit", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    sign.mockReset().mockResolvedValue({ signedTxXdr: "SIGNED", signerAddress: "G" });
    submit.mockReset();
  });

  const run = async (xdr = "XDR") => {
    const promise = signAndSubmit(xdr, "G", "pass");
    promise.catch(() => {});
    await vi.runAllTimersAsync();
    return promise;
  };

  it("retries transient failures then succeeds", async () => {
    submit.mockRejectedValueOnce(new ApiUnreachableError(null)).mockRejectedValueOnce(new ApiError("down", 503));
    submit.mockResolvedValueOnce({ confirmed: false, txHash: "HASH" }).mockResolvedValueOnce(confirmed);
    await expect(run()).resolves.toBe("HASH");
    expect(submit).toHaveBeenCalledTimes(4);
  });

  it("fails after exhausting retries", async () => {
    submit.mockRejectedValue(new ApiUnreachableError(null));
    await expect(run()).rejects.toBeInstanceOf(ApiUnreachableError);
    expect(submit).toHaveBeenCalledTimes(4);
  });

  it("does not retry a definitive rejection", async () => {
    submit.mockResolvedValue({ confirmed: false, txHash: "HASH", error: "tx_failed" });
    await expect(run()).rejects.toThrow("tx_failed");
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("does not retry a 4xx", async () => {
    submit.mockRejectedValue(new ApiError("bad", 400));
    await expect(run()).rejects.toThrow("bad");
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("throws when signing is declined", async () => {
    sign.mockResolvedValue({ signedTxXdr: "", signerAddress: "", error: { code: -4, message: "declined" } });
    await expect(run()).rejects.toThrow("declined");
    expect(submit).not.toHaveBeenCalled();
  });

  it("dedupes concurrent calls for the same envelope", async () => {
    submit.mockResolvedValue(confirmed);
    const [a, b] = await Promise.all([run("SAME"), run("SAME")]);
    expect([a, b]).toEqual(["HASH", "HASH"]);
    expect(sign).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("dedupes submission of the same signed envelope from different unsigned txs", async () => {
    submit.mockResolvedValue(confirmed);
    await Promise.all([run("A"), run("B")]);
    expect(sign).toHaveBeenCalledTimes(2);
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("allows a fresh attempt once the previous one settled", async () => {
    submit.mockResolvedValue(confirmed);
    await run("X");
    await run("X");
    expect(submit).toHaveBeenCalledTimes(2);
  });
});
