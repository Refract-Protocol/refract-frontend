/**
 * Realtime connection health observability.
 *
 * A tiny store-like emitter that the realtime client pushes health signals
 * into and React (via `useRealtimeHealth`) subscribes to. Kept free of socket
 * internals so consumers only ever see sanitized, machine-readable state.
 */

export enum RealtimeStatus {
  Idle = "idle",
  Connecting = "connecting",
  Connected = "connected",
  Reconnecting = "reconnecting",
  Disconnected = "disconnected",
  Error = "error",
}

export type RealtimeTransport = "websocket" | "polling" | "long-polling" | "unknown";

export interface RealtimeHealthSnapshot {
  status: RealtimeStatus;
  transport: RealtimeTransport;
  attemptCount: number;
  lastMessageAt: number | null;
  lastMessageAgeMs: number | null;
  lastError: string | null;
  errorCount: number;
}

export interface RealtimeHealthEvent {
  type: "status" | "error" | "message";
  snapshot: RealtimeHealthSnapshot;
  error?: string;
}

export type RealtimeHealthListener = (event: RealtimeHealthEvent) => void;

export interface RealtimeHealthReporter {
  captureMessage?: (message: string, context?: Record<string, unknown>) => void;
  captureException?: (error: unknown, context?: Record<string, unknown>) => void;
}

const MAX_REPORTED_RECONNECT_LOOPS = 5;
const MESSAGE_COALESCE_MS = 1000;

const SECRET_PATTERNS: RegExp[] = [
  /([?&](?:token|access_token|auth|apikey|api_key|key|secret|password)=)[^&\s]+/gi,
  /(bearer\s+)[A-Za-z0-9._\-]+/gi,
  /(wss?:\/\/)[^@\s/]+@/gi,
];

/** Redact tokens, credentials, and embedded URLs from anything we report. */
export function redactSecrets(input: string): string {
  let out = input;
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, (_match, prefix: string) => `${prefix}[REDACTED]`);
  }
  return out;
}

function createInitialSnapshot(): RealtimeHealthSnapshot {
  return {
    status: RealtimeStatus.Idle,
    transport: "unknown",
    attemptCount: 0,
    lastMessageAt: null,
    lastMessageAgeMs: null,
    lastError: null,
    errorCount: 0,
  };
}

class RealtimeHealthStore {
  private snapshot: RealtimeHealthSnapshot = createInitialSnapshot();
  private listeners = new Set<RealtimeHealthListener>();
  private reporter: RealtimeHealthReporter | null = null;
  private reportedReconnectLoops = 0;
  private lastMessageEmitAt = 0;
  private pendingMessageTimer: ReturnType<typeof setTimeout> | null = null;

  getSnapshot(): RealtimeHealthSnapshot {
    return this.snapshot;
  }

  subscribe(listener: RealtimeHealthListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  setReporter(reporter: RealtimeHealthReporter | null): void {
    this.reporter = reporter;
  }

  private emit(event: RealtimeHealthEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // A misbehaving subscriber must never break the realtime layer.
      }
    }
  }

  private update(patch: Partial<RealtimeHealthSnapshot>): RealtimeHealthSnapshot {
    this.snapshot = { ...this.snapshot, ...patch };
    return this.snapshot;
  }

  setStatus(status: RealtimeStatus, transport?: RealtimeTransport): void {
    const previous = this.snapshot.status;
    if (previous === status && (transport === undefined || transport === this.snapshot.transport)) {
      return;
    }
    const snapshot = this.update({
      status,
      transport: transport ?? this.snapshot.transport,
    });
    this.emit({ type: "status", snapshot });
    this.reportStatusTransition(previous, snapshot);
  }

  recordConnectAttempt(): void {
    const snapshot = this.update({ attemptCount: this.snapshot.attemptCount + 1 });
    this.emit({ type: "status", snapshot });
  }

  recordMessage(): void {
    const now = Date.now();
    this.update({ lastMessageAt: now, lastMessageAgeMs: 0 });
    // Coalesce high-frequency message updates into at most one emit per window.
    if (this.pendingMessageTimer) {
      return;
    }
    const elapsed = now - this.lastMessageEmitAt;
    if (elapsed >= MESSAGE_COALESCE_MS) {
      this.lastMessageEmitAt = now;
      this.emit({ type: "message", snapshot: this.snapshot });
      return;
    }
    this.pendingMessageTimer = setTimeout(() => {
      this.pendingMessageTimer = null;
      this.lastMessageEmitAt = Date.now();
      this.emit({ type: "message", snapshot: this.snapshot });
    }, MESSAGE_COALESCE_MS - elapsed);
  }

  recordError(error: unknown): void {
    const raw = error instanceof Error ? error.message : String(error);
    const message = redactSecrets(raw);
    const snapshot = this.update({
      status: RealtimeStatus.Error,
      lastError: message,
      errorCount: this.snapshot.errorCount + 1,
    });
    this.emit({ type: "error", snapshot, error: message });
    this.reportError(message);
  }

  private reportStatusTransition(
    previous: RealtimeStatus,
    snapshot: RealtimeHealthSnapshot,
  ): void {
    if (!this.reporter) {
      return;
    }
    const context = {
      status: snapshot.status,
      previousStatus: previous,
      transport: snapshot.transport,
      attemptCount: snapshot.attemptCount,
    };
    this.reporter.captureMessage?.(`realtime:${snapshot.status}`, context);

    if (snapshot.status === RealtimeStatus.Reconnecting) {
      if (this.reportedReconnectLoops < MAX_REPORTED_RECONNECT_LOOPS) {
        this.reportedReconnectLoops += 1;
        this.reporter.captureMessage?.("realtime:reconnect-loop", context);
      }
    } else if (snapshot.status === RealtimeStatus.Connected) {
      this.reportedReconnectLoops = 0;
    }
  }

  private reportError(message: string): void {
    if (!this.reporter) {
      return;
    }
    const context = {
      status: this.snapshot.status,
      transport: this.snapshot.transport,
      attemptCount: this.snapshot.attemptCount,
      errorCount: this.snapshot.errorCount,
    };
    if (this.reporter.captureException) {
      this.reporter.captureException(new Error(message), context);
    } else {
      this.reporter.captureMessage?.(`realtime:error:${message}`, context);
    }
  }

  reset(): void {
    if (this.pendingMessageTimer) {
      clearTimeout(this.pendingMessageTimer);
      this.pendingMessageTimer = null;
    }
    this.reportedReconnectLoops = 0;
    this.lastMessageEmitAt = 0;
    this.snapshot = createInitialSnapshot();
    this.emit({ type: "status", snapshot: this.snapshot });
  }
}

export const realtimeHealth = new RealtimeHealthStore();
