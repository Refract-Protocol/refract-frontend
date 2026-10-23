import { isResponseFrame } from "./contract";

export type RequestFailureReason = "timeout" | "aborted" | "disconnected" | "overflow" | "server";

export class RealtimeRequestError extends Error {
  constructor(
    readonly reason: RequestFailureReason,
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = "RealtimeRequestError";
  }
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (err: RealtimeRequestError) => void;
  timer: ReturnType<typeof setTimeout>;
  cleanup: () => void;
}

export interface RequestOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}

export const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
export const MAX_PENDING_REQUESTS = 100;

/**
 * Owns correlation IDs and the pending-request map. Transports only own
 * framing: they call `send` to write a frame and `handleFrame` on dispatch.
 */
export class RequestCorrelator {
  private nextId = 1;
  private pending = new Map<number, Pending>();

  get size(): number {
    return this.pending.size;
  }

  request<T>(
    send: (frame: string) => void,
    topic: string,
    payload: unknown,
    { timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS, signal }: RequestOptions = {},
  ): Promise<T> {
    if (signal?.aborted) {
      return Promise.reject(new RealtimeRequestError("aborted", "Request aborted"));
    }
    if (this.pending.size >= MAX_PENDING_REQUESTS) {
      return Promise.reject(new RealtimeRequestError("overflow", "Too many pending requests"));
    }
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const finish = () => {
        const entry = this.pending.get(id);
        if (!entry) return;
        clearTimeout(entry.timer);
        entry.cleanup();
        this.pending.delete(id);
      };
      const onAbort = () => {
        finish();
        reject(new RealtimeRequestError("aborted", "Request aborted"));
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      this.pending.set(id, {
        resolve: (v) => {
          finish();
          resolve(v as T);
        },
        reject: (e) => {
          finish();
          reject(e);
        },
        timer: setTimeout(() => {
          finish();
          reject(new RealtimeRequestError("timeout", `Request "${topic}" timed out`));
        }, timeoutMs),
        cleanup: () => signal?.removeEventListener("abort", onAbort),
      });
      try {
        send(JSON.stringify({ id, topic, request: payload }));
      } catch (err) {
        this.pending.get(id)?.reject(new RealtimeRequestError("disconnected", String(err)));
      }
    });
  }

  /** Returns true when the frame was a response/error frame (consumed here). */
  handleFrame(frame: unknown): boolean {
    if (!isResponseFrame(frame)) return false;
    const entry = this.pending.get(frame.id);
    // Stale or duplicate ids are consumed but ignored.
    if (!entry) return true;
    if ("error" in frame) {
      entry.reject(new RealtimeRequestError("server", frame.error.message, frame.error.code));
    } else {
      entry.resolve(frame.response);
    }
    return true;
  }

  rejectAll(reason: RequestFailureReason = "disconnected"): void {
    for (const entry of [...this.pending.values()]) {
      entry.reject(new RealtimeRequestError(reason, "Realtime connection closed"));
    }
  }
}
