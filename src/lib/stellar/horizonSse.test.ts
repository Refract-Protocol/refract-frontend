import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  parseOperations,
  streamOperations,
  type HorizonOperation,
  type HistoryEntry,
} from "@/lib/stellar/horizon";

// Minimal mock EventSource for testing streamOperations.
class MockEventSource {
  static instances: MockEventSource[] = [];
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  url: string;
  closed = false;

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  close(): void {
    this.closed = true;
  }

  /** Simulate Horizon pushing an SSE event. */
  push(data: object): void {
    this.onmessage?.({ data: JSON.stringify(data) });
  }

  /** Simulate a connection error. */
  error(): void {
    this.onerror?.(new Event("error"));
  }
}

describe("parseOperations (SSE-relevant)", () => {
  it("filters to invoke_host_function operations only", () => {
    const records: HorizonOperation[] = [
      { id: "1", paging_token: "1", type: "payment", created_at: "2025-01-01T00:00:00Z", transaction_hash: "abc" },
      { id: "2", paging_token: "2", type: "invoke_host_function", created_at: "2025-01-02T00:00:00Z", transaction_hash: "def" },
    ];
    const entries = parseOperations(records, []);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.id).toBe("2");
  });

  it("passes through all contract calls when no contract IDs configured", () => {
    const records: HorizonOperation[] = [
      {
        id: "1",
        paging_token: "1",
        type: "invoke_host_function",
        created_at: "2025-01-01T00:00:00Z",
        transaction_hash: "abc",
        parameters: [
          { type: "address", value: "AAAAAQAAAC" },
          { type: "symbol", value: "AAAAAQAAAAdidXNlcl9" },
        ],
      },
    ];
    const entries = parseOperations(records, []);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.operation).toBe("contract_call");
  });

  it("filters by contract ID when configured", () => {
    const records: HorizonOperation[] = [
      {
        id: "1",
        paging_token: "1",
        type: "invoke_host_function",
        created_at: "2025-01-01T00:00:00Z",
        transaction_hash: "abc",
        parameters: [
          { type: "address", value: "AAAAAQAAAC" },
          { type: "symbol", value: "AAAAAQAAAAdidXNlcl9" },
        ],
      },
    ];
    // With a non-matching contract ID, the entry is filtered out.
    const entries = parseOperations(records, ["CDUMMYCONTRACTID"]);
    expect(entries).toHaveLength(0);
  });

  it("extracts amount and asset from asset_balance_changes", () => {
    const records: HorizonOperation[] = [
      {
        id: "1",
        paging_token: "1",
        type: "invoke_host_function",
        created_at: "2025-01-01T00:00:00Z",
        transaction_hash: "abc",
        transaction_successful: true,
        asset_balance_changes: [
          { asset_type: "credit_alphanum4", asset_code: "USDC", from: "a", to: "b", amount: "100.5", type: "transfer" },
        ],
      },
    ];
    const entries = parseOperations(records, []);
    expect(entries[0]!.amount).toBe(100.5);
    expect(entries[0]!.asset).toBe("USDC");
    expect(entries[0]!.successful).toBe(true);
  });
});

describe("streamOperations", () => {
  beforeEach(() => {
    MockEventSource.instances = [];
    // Replace the global EventSource with our mock.
    (globalThis as unknown as { EventSource: typeof MockEventSource }).EventSource = MockEventSource;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    // Clean up the mock.
    delete (globalThis as unknown as { EventSource?: typeof EventSource }).EventSource;
  });

  it("calls onEntry for each Refract-filtered operation from the SSE stream", () => {
    const onEntry = vi.fn();
    const close = streamOperations("GDEMOADDRESS", { onEntry });

    expect(MockEventSource.instances).toHaveLength(1);
    const source = MockEventSource.instances[0]!;

    // Push a non-invoke operation — should be filtered out.
    source.push({ id: "1", type: "payment", created_at: "2025-01-01T00:00:00Z", transaction_hash: "abc", paging_token: "1" });

    // Push an invoke_host_function operation — should pass through (no contract filter).
    source.push({
      id: "2",
      type: "invoke_host_function",
      created_at: "2025-01-02T00:00:00Z",
      transaction_hash: "def",
      paging_token: "2",
    });

    expect(onEntry).toHaveBeenCalledTimes(1);
    expect(onEntry.mock.calls[0]![0].id).toBe("2");

    close();
    expect(source.closed).toBe(true);
  });

  it("calls onError when the EventSource reports an error", () => {
    const onEntry = vi.fn();
    const onError = vi.fn();
    const close = streamOperations("GDEMOADDRESS", { onEntry, onError });

    const source = MockEventSource.instances[0]!;
    source.error();

    expect(onError).toHaveBeenCalledTimes(1);
    close();
  });

  it("ignores malformed SSE data", () => {
    const onEntry = vi.fn();
    const close = streamOperations("GDEMOADDRESS", { onEntry });

    const source = MockEventSource.instances[0]!;
    // Manually invoke onmessage with invalid JSON.
    source.onmessage?.({ data: "not json" });

    expect(onEntry).not.toHaveBeenCalled();
    close();
  });

  it("returns a no-op close when EventSource is unavailable", () => {
    // Remove the mock to simulate no EventSource.
    delete (globalThis as unknown as { EventSource?: typeof EventSource }).EventSource;
    const close = streamOperations("GDEMOADDRESS", { onEntry: vi.fn() });
    // Should not throw, returns a function.
    expect(typeof close).toBe("function");
    close();
  });
});
