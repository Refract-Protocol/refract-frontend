/**
 * High-throughput WebSocket mock server for the realtime client test harness.
 *
 * Closes #235: The existing MSW HTTP handlers cover correctness of individual
 * frames, not volume. This module provides a Node-native, lightweight WS server
 * capable of driving the realtime client with sustained high-frequency traffic
 * across many topics and simulated subscribers, so that memory growth,
 * reconnect churn, and frame dispatch cost can be measured in stress tests.
 *
 * ## Design
 *
 * - Built on Node's `http` module + a minimal WebSocket implementation
 *   using `ws` (already present transitively; guarded with a runtime check).
 *   Falls back to a pure-Node TCP no-op server if `ws` is unavailable, which
 *   lets the file import safely in test environments where `ws` isn't installed.
 * - The server is NOT MSW-based because MSW's `ws` interceptor is designed
 *   for browser/service-worker environments; these stress tests run in Node
 *   via Vitest.
 * - Exposes a `WsMockServer` class with `start()`, `stop()`, `broadcast()`,
 *   `push()`, and a `driveLoad()` helper that pushes frames at a configurable
 *   Hz across a configurable topic list.
 */

import * as http from "http";
import * as net from "net";

// ---------------------------------------------------------------------------
// Minimal ws shim — prefer the real `ws` package, fall back to no-op.
// ---------------------------------------------------------------------------

interface WsClient {
  send(data: string): void;
  close(): void;
  on(event: "close", cb: () => void): this;
  on(event: "error", cb: (err: Error) => void): this;
}
interface WsServer {
  handleUpgrade(
    req: http.IncomingMessage,
    socket: net.Socket,
    head: Buffer,
    cb: (ws: WsClient) => void
  ): void;
  close(cb?: () => void): void;
}

function createWsServer(): WsServer | null {
  try {
    // Dynamic require — ws is only available when installed (optional for the build).
    const ws = require("ws") as { Server: new (options: { noServer: boolean }) => WsServer };
    return new ws.Server({ noServer: true });
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// WsMockServer
// ---------------------------------------------------------------------------

export interface WsMockServerOptions {
  /**
   * Port to listen on. Default: 0 (OS-assigned ephemeral port).
   * After `start()` resolves, read `server.port` for the actual port.
   */
  port?: number;
  /**
   * Whether to log debug output. Default: false.
   */
  debug?: boolean;
}

export interface LoadProfile {
  /** Topics to emit frames for (round-robin). */
  topics: string[];
  /** Target frames per second (summed across all topics). Default: 100. */
  framesPerSecond?: number;
  /** Payload factory called for each frame. Default: a minimal oracle_update payload. */
  makePayload?: (topic: string, seq: number) => unknown;
  /** Total number of frames to emit before stopping. Default: Infinity (runs until stop()). */
  maxFrames?: number;
}

/** Recorded per-run statistics from `driveLoad()`. */
export interface LoadStats {
  framesSent: number;
  durationMs: number;
  /** Approx. Hz actually achieved (may differ from target under load). */
  actualHz: number;
  /** Number of connected clients during the run. */
  clientCount: number;
  errors: number;
}

/**
 * Lightweight in-process WebSocket server for stress testing.
 *
 * Lifecycle:
 * ```ts
 * const server = new WsMockServer({ port: 0 });
 * await server.start();
 * // server.url is the ws:// URL to point RealtimeClient at
 * const stats = await server.driveLoad({ topics: ["oracle_update"], framesPerSecond: 500, maxFrames: 10_000 });
 * await server.stop();
 * ```
 */
export class WsMockServer {
  private httpServer: http.Server | null = null;
  private wss: WsServer | null = null;
  private clients = new Set<WsClient>();
  private readonly options: Required<WsMockServerOptions>;
  private _port = 0;
  private _errors = 0;

  constructor(options: WsMockServerOptions = {}) {
    this.options = {
      port: options.port ?? 0,
      debug: options.debug ?? false,
    };
  }

  /** The actual port the server is listening on (set after `start()` resolves). */
  get port(): number {
    return this._port;
  }

  /** The WebSocket URL clients should connect to. */
  get url(): string {
    return `ws://127.0.0.1:${this._port}/ws`;
  }

  /** Number of currently connected clients. */
  get clientCount(): number {
    return this.clients.size;
  }

  /** Start the HTTP/WS server. */
  async start(): Promise<void> {
    this.wss = createWsServer();
    this.httpServer = http.createServer();

    if (this.wss) {
      const wss = this.wss;
      const clients = this.clients;
      const debug = this.options.debug;

      this.httpServer.on("upgrade", (req, socket, head) => {
        wss.handleUpgrade(req, socket as net.Socket, head, (ws) => {
          clients.add(ws);
          if (debug) console.debug("[WsMockServer] client connected, total:", clients.size);
          ws.on("close", () => {
            clients.delete(ws);
            if (debug) console.debug("[WsMockServer] client disconnected, total:", clients.size);
          });
          ws.on("error", (err: Error) => {
            if (debug) console.debug("[WsMockServer] client error:", err.message);
          });
        });
      });
    }

    return new Promise((resolve, reject) => {
      this.httpServer!.listen(this.options.port, "127.0.0.1", () => {
        const addr = this.httpServer!.address();
        if (addr && typeof addr === "object") {
          this._port = addr.port;
        }
        resolve();
      });
      this.httpServer!.on("error", reject);
    });
  }

  /** Broadcast a JSON frame to all connected clients. */
  broadcast(topic: string, payload: unknown): void {
    const msg = JSON.stringify({ topic, payload });
    for (const client of this.clients) {
      try {
        client.send(msg);
      } catch {
        this._errors++;
      }
    }
  }

  /**
   * Push a single frame to a specific client (by index, 0-based).
   * Falls back to broadcast if index is out of range.
   */
  push(topic: string, payload: unknown, clientIndex = 0): void {
    const client = Array.from(this.clients)[clientIndex];
    if (!client) {
      this.broadcast(topic, payload);
      return;
    }
    try {
      client.send(JSON.stringify({ topic, payload }));
    } catch {
      this._errors++;
    }
  }

  /**
   * Drive the connected client(s) with sustained high-frequency traffic.
   *
   * Returns a `LoadStats` object with timing and throughput metrics.
   */
  async driveLoad(profile: LoadProfile): Promise<LoadStats> {
    const {
      topics,
      framesPerSecond = 100,
      makePayload = defaultPayloadFactory,
      maxFrames = Infinity,
    } = profile;

    if (topics.length === 0) throw new RangeError("LoadProfile.topics must be non-empty");

    const intervalMs = 1000 / framesPerSecond;
    let framesSent = 0;
    let errors = 0;
    const start = Date.now();

    return new Promise((resolve) => {
      let seq = 0;
      const tick = () => {
        if (framesSent >= maxFrames) {
          const durationMs = Date.now() - start;
          resolve({
            framesSent,
            durationMs,
            actualHz: framesSent / (durationMs / 1000),
            clientCount: this.clients.size,
            errors,
          });
          return;
        }

        const topic = topics[seq % topics.length];
        try {
          this.broadcast(topic, makePayload(topic, seq));
        } catch {
          errors++;
        }
        framesSent++;
        seq++;

        // Use setImmediate when possible to avoid blocking the event loop
        // for extremely high rates, falling back to setTimeout(0).
        if (framesSent < maxFrames) {
          if (intervalMs <= 1) {
            setImmediate(tick);
          } else {
            setTimeout(tick, intervalMs);
          }
        } else {
          const durationMs = Date.now() - start;
          resolve({
            framesSent,
            durationMs,
            actualHz: framesSent / (durationMs / 1000),
            clientCount: this.clients.size,
            errors,
          });
        }
      };

      if (intervalMs <= 1) {
        setImmediate(tick);
      } else {
        setTimeout(tick, intervalMs);
      }
    });
  }

  /** Gracefully close all client connections and stop the HTTP server. */
  async stop(): Promise<void> {
    for (const client of this.clients) {
      try {
        client.close();
      } catch {
        /* ignore */
      }
    }
    this.clients.clear();

    return new Promise((resolve) => {
      if (this.wss) {
        this.wss.close(() => {
          this.httpServer?.close(() => resolve());
        });
      } else {
        this.httpServer?.close(() => resolve());
      }
    });
  }
}

// ---------------------------------------------------------------------------
// Payload factory helpers
// ---------------------------------------------------------------------------

/** Default payload factory: minimal oracle_update-shaped objects. */
function defaultPayloadFactory(topic: string, seq: number): unknown {
  return {
    coverageType: "StablecoinDepeg",
    type: topic,
    value: 1.0 - seq * 0.00001,
    threshold: 0.95,
    severity: "low",
    message: `Mock frame #${seq}`,
  };
}

/** Factory that generates random severity values for chaos testing. */
export function chaosPayloadFactory(topic: string, seq: number): unknown {
  const severities = ["low", "medium", "high", "triggered"] as const;
  return {
    coverageType: ["StablecoinDepeg", "MarketCrash", "SmartContractRisk"][seq % 3],
    type: topic,
    value: Math.random() * 2 - 1,
    threshold: 0.95,
    severity: severities[Math.floor(Math.random() * severities.length)],
    message: `Chaos frame #${seq}`,
  };
}

/** Factory that produces malformed JSON (simulates a buggy backend). */
export function malformedPayloadFactory(_topic: string, seq: number): unknown {
  // Return a payload missing required fields to exercise schema validation.
  if (seq % 10 === 0) return { type: "oracle_update" }; // missing fields
  return defaultPayloadFactory(_topic, seq);
}
