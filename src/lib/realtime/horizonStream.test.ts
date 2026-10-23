import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/network", () => ({ ACTIVE_NETWORK: { horizonUrl: "https://horizon.test" } }));
vi.mock("@/lib/stellar/horizon", () => ({
  parseOperations: (ops: { id: string }[]) => ops.map((o) => ({ id: o.id })),
}));
vi.mock("./client", () => ({ realtimeClient: { registerTransport: () => () => {} } }));

import { HorizonStreamTransport, openHorizonStream } from "./horizonStream";

class FakeES {
  static instances: FakeES[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  constructor(public url: string) {
    FakeES.instances.push(this);
  }
  close() {
    this.closed = true;
  }
}

const op = (token: string) => ({
  id: token,
  paging_token: token,
  type: "invoke_host_function",
  created_at: "2026-01-01T00:00:00Z",
  transaction_hash: "h" + token,
  parameters: [],
});

afterEach(() => {
  FakeES.instances = [];
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("HorizonStreamTransport", () => {
  it("resumes from the last paging_token after a drop, with backoff", () => {
    vi.useFakeTimers();
    vi.stubGlobal("EventSource", FakeES);
    const seen: string[][] = [];
    const t = new HorizonStreamTransport("GABC", "100", (e) => seen.push(e.map((x) => x.id)));
    t.start();
    expect(FakeES.instances[0].url).toContain("cursor=100");
    FakeES.instances[0].onmessage?.({ data: '"hello"' });
    FakeES.instances[0].onmessage?.({ data: JSON.stringify(op("200")) });
    expect(seen).toEqual([["200"]]);
    FakeES.instances[0].onerror?.();
    expect(FakeES.instances).toHaveLength(1);
    vi.advanceTimersByTime(1_000);
    expect(FakeES.instances).toHaveLength(2);
    expect(FakeES.instances[1].url).toContain("cursor=200");
    t.stop();
    expect(FakeES.instances[1].closed).toBe(true);
  });

  it("keeps only one stream per account", () => {
    vi.stubGlobal("EventSource", FakeES);
    const a = openHorizonStream("GABC", "now", () => {});
    openHorizonStream("GABC", "now", () => {});
    expect(FakeES.instances.filter((s) => !s.closed)).toHaveLength(1);
    a();
  });
});
