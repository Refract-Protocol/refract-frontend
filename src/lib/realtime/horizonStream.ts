import { ACTIVE_NETWORK } from "@/lib/network";
import { parseOperations, type HistoryEntry, type HorizonOperation } from "@/lib/stellar/horizon";
import { realtimeClient, type StreamTransport } from "./client";

const BASE_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;

/** Horizon streams are one-per-account: opening a second for the same address reuses the first. */
const active = new Map<string, HorizonStreamTransport>();

/**
 * Horizon native SSE (`/accounts/{id}/operations`) as a realtime transport.
 * Resumes from the last `paging_token`, reconnects with backoff when Horizon
 * closes the stream, and shares the realtime client's wake/resync lifecycle.
 */
export class HorizonStreamTransport implements StreamTransport {
  private source: EventSource | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private attempt = 0;
  private running = false;
  private unregister: (() => void) | null = null;

  constructor(
    private readonly address: string,
    private cursor: string,
    private readonly onEntries: (entries: HistoryEntry[]) => void
  ) {}

  get url(): string {
    return `${ACTIVE_NETWORK.horizonUrl}/accounts/${this.address}/operations?cursor=${encodeURIComponent(this.cursor)}&join=transactions`;
  }

  start(): void {
    if (this.running || typeof EventSource === "undefined") return;
    this.running = true;
    this.open();
  }

  private open(): void {
    const source = new EventSource(this.url);
    this.source = source;
    source.onopen = () => {
      this.attempt = 0;
    };
    source.onmessage = (event) => {
      let op: HorizonOperation;
      try {
        op = JSON.parse(event.data as string) as HorizonOperation;
      } catch {
        return; // Horizon's initial "hello" frame is not JSON.
      }
      if (!op || typeof op !== "object" || !op.paging_token) return;
      this.cursor = op.paging_token;
      const entries = parseOperations([op]);
      if (entries.length > 0) this.onEntries(entries);
    };
    source.onerror = () => {
      source.close();
      if (this.source === source) this.source = null;
      if (!this.running || this.timer) return;
      const delay = Math.min(BASE_BACKOFF_MS * 2 ** this.attempt, MAX_BACKOFF_MS);
      this.attempt += 1;
      this.timer = setTimeout(() => {
        this.timer = null;
        if (this.running) this.open();
      }, delay);
    };
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.source?.close();
    this.source = null;
  }

  /** Full teardown (account switch / unmount): stops the stream and leaves the client lifecycle. */
  dispose(): void {
    this.stop();
    this.unregister?.();
    this.unregister = null;
    if (active.get(this.address) === this) active.delete(this.address);
  }

  attach(): void {
    this.unregister = realtimeClient.registerTransport(this);
    this.start();
  }
}

/** Opens (or replaces) the single stream for `address`, starting after `cursor`. */
export function openHorizonStream(
  address: string,
  cursor: string,
  onEntries: (entries: HistoryEntry[]) => void
): () => void {
  active.get(address)?.dispose();
  const transport = new HorizonStreamTransport(address, cursor, onEntries);
  active.set(address, transport);
  transport.attach();
  if (typeof window !== "undefined")
    window.addEventListener("pagehide", () => transport.dispose(), { once: true });
  return () => transport.dispose();
}
