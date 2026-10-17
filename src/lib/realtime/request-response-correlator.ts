export type RealtimeRequestErrorCode =
  | 'REALTIME_REQUEST_TIMEOUT'
  | 'REALTIME_REQUEST_ABORTED'
  | 'REALTIME_TRANSPORT_DISCONNECTED'
  | 'REALTIME_PENDING_LIMIT_EXCEEDED'
  | 'REALTIME_SERVER_ERROR';

export class RealtimeRequestError extends Error {
  readonly code: RealtimeRequestErrorCode;
  readonly correlationId?: string;

  constructor(
    code: RealtimeRequestErrorCode,
    message: string,
    correlationId?: string
  ) {
    super(message);
    this.name = 'RealtimeRequestError';
    this.code = code;
    this.correlationId = correlationId;
  }
}

export interface RealtimeQueryRequestFrame<TPayload = unknown> {
  type: 'query_request';
  correlationId: string;
  topic: string;
  payload: TPayload;
}

export interface RealtimeQueryResponseFrame<TResult = unknown> {
  type: 'query_response';
  correlationId: string;
  ok: boolean;
  data?: TResult;
  error?: string;
}

export interface RequestCallOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}

interface PendingEntry {
  correlationId: string;
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timerId: ReturnType<typeof setTimeout>;
  cleanupAbort?: () => void;
}

/**
 * Multiplexes correlation-ID-based one-shot request/response queries onto an active
 * realtime connection without leaking response frames into topic subscription listeners.
 */
export class RealtimeRequestCorrelator {
  private sequence = 0;
  private readonly pending = new Map<string, PendingEntry>();
  private readonly defaultTimeoutMs: number;
  private readonly maxPendingRequests: number;
  private readonly sendFrame: (frame: RealtimeQueryRequestFrame) => void;

  constructor(options: {
    sendFrame: (frame: RealtimeQueryRequestFrame) => void;
    defaultTimeoutMs?: number;
    maxPendingRequests?: number;
  }) {
    this.sendFrame = options.sendFrame;
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 5_000;
    this.maxPendingRequests = options.maxPendingRequests ?? 100;
  }

  getPendingCount(): number {
    return this.pending.size;
  }

  request<TResponse = unknown, TPayload = unknown>(
    topic: string,
    payload: TPayload,
    options: RequestCallOptions = {}
  ): Promise<TResponse> {
    if (options.signal?.aborted) {
      return Promise.reject(
        new RealtimeRequestError(
          'REALTIME_REQUEST_ABORTED',
          `Request for topic "${topic}" was aborted before send.`
        )
      );
    }

    if (this.pending.size >= this.maxPendingRequests) {
      return Promise.reject(
        new RealtimeRequestError(
          'REALTIME_PENDING_LIMIT_EXCEEDED',
          `Pending request limit (${this.maxPendingRequests}) exceeded.`
        )
      );
    }

    this.sequence += 1;
    const correlationId = `req-${this.sequence}`;
    const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs;

    return new Promise<TResponse>((resolve, reject) => {
      const timerId = setTimeout(() => {
        this.removePending(correlationId);
        reject(
          new RealtimeRequestError(
            'REALTIME_REQUEST_TIMEOUT',
            `Realtime query "${topic}" (${correlationId}) timed out after ${timeoutMs}ms.`,
            correlationId
          )
        );
      }, timeoutMs);

      let cleanupAbort: (() => void) | undefined;
      if (options.signal) {
        const onAbort = (): void => {
          this.removePending(correlationId);
          reject(
            new RealtimeRequestError(
              'REALTIME_REQUEST_ABORTED',
              `Realtime query "${topic}" (${correlationId}) was aborted.`,
              correlationId
            )
          );
        };
        options.signal.addEventListener('abort', onAbort, { once: true });
        cleanupAbort = () => options.signal?.removeEventListener('abort', onAbort);
      }

      this.pending.set(correlationId, {
        correlationId,
        resolve: (val) => resolve(val as TResponse),
        reject,
        timerId,
        cleanupAbort,
      });

      this.sendFrame({
        type: 'query_request',
        correlationId,
        topic,
        payload,
      });
    });
  }

  /**
   * Intercepts incoming transport frames. Returns `true` if the frame is a correlated
   * query response (consumed here and must NOT be forwarded to topic listeners).
   */
  handleIncomingFrame(frame: unknown): boolean {
    if (
      typeof frame !== 'object' ||
      frame === null ||
      (frame as Record<string, unknown>).type !== 'query_response'
    ) {
      return false;
    }

    const response = frame as RealtimeQueryResponseFrame;
    const entry = this.removePending(response.correlationId);
    if (!entry) {
      // Stale or duplicate correlation ID is still consumed so it never leaks to topic listeners
      return true;
    }

    if (response.ok) {
      entry.resolve(response.data);
    } else {
      entry.reject(
        new RealtimeRequestError(
          'REALTIME_SERVER_ERROR',
          response.error ?? 'Realtime server query failed',
          response.correlationId
        )
      );
    }

    return true;
  }

  /**
   * Rejects all in-flight requests deterministically when the socket disconnects or tears down.
   */
  handleDisconnect(reason = 'Realtime transport disconnected'): void {
    const entries = Array.from(this.pending.values());
    this.pending.clear();

    for (const entry of entries) {
      clearTimeout(entry.timerId);
      entry.cleanupAbort?.();
      entry.reject(
        new RealtimeRequestError(
          'REALTIME_TRANSPORT_DISCONNECTED',
          reason,
          entry.correlationId
        )
      );
    }
  }

  private removePending(correlationId: string): PendingEntry | undefined {
    const entry = this.pending.get(correlationId);
    if (!entry) return undefined;
    this.pending.delete(correlationId);
    clearTimeout(entry.timerId);
    entry.cleanupAbort?.();
    return entry;
  }
}
