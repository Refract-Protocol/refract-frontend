import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { startSorobanEvents } from "./sorobanEvents";

const ok = (result: unknown) =>
  ({ ok: true, status: 200, json: async () => ({ result }) }) as Response;
const base = {
  networkId: "testnet" as const,
  rpcUrl: "http://rpc",
  contracts: { C1: "policy" },
  pollMs: 1000,
  random: () => 1,
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("startSorobanEvents", () => {
  it("is a no-op without contract IDs", () => {
    const fetchImpl = vi.fn();
    startSorobanEvents({ ...base, contracts: {}, publish: vi.fn(), fetchImpl })();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("advances the cursor and suppresses duplicate events", async () => {
    const ev = { id: "e1", ledger: 5, contractId: "C1", topic: [], value: 1 };
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(ok({ sequence: 10 }))
      .mockResolvedValueOnce(
        ok({ events: [ev], cursor: "cur1", latestLedger: 11, oldestLedger: 1 })
      )
      .mockResolvedValueOnce(
        ok({ events: [ev], cursor: "cur2", latestLedger: 12, oldestLedger: 1 })
      );
    const publish = vi.fn();
    const stop = startSorobanEvents({ ...base, publish, fetchImpl });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish.mock.calls[0][0]).toBe("contract_events:policy");
    const lastBody = JSON.parse(fetchImpl.mock.calls[2][1].body);
    expect(lastBody.params.pagination.cursor).toBe("cur1");
    stop();
  });

  it("resyncs when the checkpoint falls out of retention", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(ok({ sequence: 10 }))
      .mockResolvedValueOnce(ok({ events: [], oldestLedger: 50, latestLedger: 100 }))
      .mockResolvedValueOnce(ok({ sequence: 100 }));
    const publish = vi.fn();
    const stop = startSorobanEvents({ ...base, publish, fetchImpl });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(publish.mock.calls[0][1]).toMatchObject({ type: "resync", ledger: 100 });
    stop();
  });

  it("backs off after a 429", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 429 } as Response);
    const stop = startSorobanEvents({ ...base, publish: vi.fn(), fetchImpl });
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(500);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(600);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    stop();
  });
});
