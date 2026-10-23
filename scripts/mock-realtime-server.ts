/**
 * Mock realtime backend with scripted fault injection.
 *
 *   npm run mock:realtime -- --port 4010 --scenario flaky --rate 500
 *
 * Serves the realtime contract (docs/realtime.md) on:
 *   ws://HOST:PORT/ws                     WebSocket transport
 *   GET  /api/v1/realtime/poll            long-poll transport
 *   POST /__control                       drive faults from tests, e.g.
 *        {"action":"publish","topic":"oracle_update","payload":{...}}
 *        {"action":"restart","loseHistory":true}
 *        {"action":"drop","code":1006}
 *        {"action":"scenario","scenario":{"default":{"rejectAuth":true}}}
 *        {"action":"raw","text":"{garbage"}
 *   GET  /__state                         connection counters (JSON)
 *
 * The WebSocket server is a minimal RFC 6455 implementation (text, close,
 * ping/pong; no extensions) so the repo needs no extra dependency.
 */
import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import { MockRealtimeServer, type MockScenario } from "../src/lib/realtime/testing/mockServer";

const PRESETS: Record<string, MockScenario> = {
  none: {},
  /** Every connection drops abruptly after 20 frames. */
  flaky: { default: { closeAfterFrames: { count: 20, code: 1006, reason: "chaos" } } },
  /** Connection 1 goes half-open after 5 frames; later ones are healthy. */
  "half-open": { connections: { 1: { stallAfterFrames: 5 } } },
  /** Every frame is delayed by 1.5s. */
  slow: { default: { frameDelayMs: 1_500 } },
  /** After the first reconnect the backend has lost subscription state. */
  "drop-subscribe": { connections: { 2: { ignoreSubscribe: true }, 3: { ignoreSubscribe: true } } },
  /** Reconnects are rejected with an auth failure. */
  "auth-reject": { default: { rejectAuth: true }, connections: { 1: {} } },
  /** Every resume re-sends the last 3 events (exercises de-duplication). */
  "at-least-once": { resumeOverlap: 3 },
};

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}

const port = Number(arg("port", "4010"));
const scenarioName = arg("scenario", "none");
const rateMs = Number(arg("rate", "0"));
const pingMs = Number(arg("ping", "10000"));
const restartEveryMs = Number(arg("restart-every", "0"));

const scenario = PRESETS[scenarioName];
if (!scenario) {
  console.error(`Unknown scenario "${scenarioName}". Known: ${Object.keys(PRESETS).join(", ")}`);
  process.exit(1);
}

const server = new MockRealtimeServer({ name: scenarioName, ...scenario });

// ── HTTP: long-poll, control, CORS ─────────────────────────────────────────

function cors(req: IncomingMessage, res: ServerResponse): void {
  res.setHeader("Access-Control-Allow-Origin", req.headers.origin ?? "*");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

const http = createServer(async (req, res) => {
  cors(req, res);
  if (req.method === "OPTIONS") return void res.writeHead(204).end();
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);

  if (url.pathname === "/api/v1/realtime/poll" && req.method === "GET") {
    const controller = new AbortController();
    req.on("close", () => controller.abort());
    try {
      const response = await server.fetch(url.toString(), { signal: controller.signal });
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(response.status === 204 ? undefined : await response.text());
    } catch {
      if (!res.headersSent) res.writeHead(499).end();
    }
    return;
  }

  if (url.pathname === "/__control" && req.method === "POST") {
    const cmd = JSON.parse(await readBody(req)) as Record<string, unknown>;
    switch (cmd.action) {
      case "publish":
        server.publish(String(cmd.topic ?? "oracle_update"), cmd.payload ?? { at: Date.now() });
        break;
      case "restart":
        server.restart({ loseHistory: Boolean(cmd.loseHistory) });
        break;
      case "drop":
        server.dropAll(Number(cmd.code ?? 1006), String(cmd.reason ?? "chaos"));
        break;
      case "scenario":
        server.setScenario(cmd.scenario as MockScenario);
        break;
      case "raw":
        server.sendRaw(String(cmd.text ?? ""));
        break;
      case "ping":
        server.ping();
        break;
      default:
        return void res.writeHead(400).end(`unknown action ${String(cmd.action)}`);
    }
    return void res.writeHead(204).end();
  }

  if (url.pathname === "/__state") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return void res.end(
      JSON.stringify({
        totalConnections: server.totalConnections,
        openConnections: server.openConnections,
      })
    );
  }

  res.writeHead(404).end();
});

// ── WebSocket (RFC 6455, minimal) ──────────────────────────────────────────

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

function encodeFrame(opcode: number, payload: Buffer): Buffer {
  const len = payload.length;
  const header =
    len < 126
      ? Buffer.from([0x80 | opcode, len])
      : len < 65_536
        ? Buffer.from([0x80 | opcode, 126, len >> 8, len & 0xff])
        : (() => {
            const h = Buffer.alloc(10);
            h[0] = 0x80 | opcode;
            h[1] = 127;
            h.writeBigUInt64BE(BigInt(len), 2);
            return h;
          })();
  return Buffer.concat([header, payload]);
}

function closePayload(code: number, reason: string): Buffer {
  const buf = Buffer.alloc(2 + Buffer.byteLength(reason));
  buf.writeUInt16BE(code, 0);
  buf.write(reason, 2);
  return buf;
}

http.on("upgrade", (req: IncomingMessage, socket: Duplex) => {
  if (new URL(req.url ?? "/", "http://x").pathname !== "/ws") return void socket.destroy();
  const key = req.headers["sec-websocket-key"];
  if (typeof key !== "string") return void socket.destroy();
  const accept = createHash("sha1")
    .update(key + WS_GUID)
    .digest("base64");

  let open = false;
  const io = {
    send: (text: string) => open && socket.write(encodeFrame(0x1, Buffer.from(text))),
    close: (code: number, reason: string) => {
      if (!open) return;
      open = false;
      socket.end(encodeFrame(0x8, closePayload(code, reason)));
    },
  };

  const accepted = server.accept(io);
  if ("refused" in accepted) {
    // Fail the handshake itself, like a proxy that blocks the upgrade: the
    // browser never sees `open`, only an error and a 1006 close.
    socket.end("HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n");
    return;
  }
  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
  );
  open = true;

  let buffer = Buffer.alloc(0);
  socket.on("data", (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 2) {
      const opcode = buffer[0]! & 0x0f;
      let len = buffer[1]! & 0x7f;
      let offset = 2;
      if (len === 126) {
        if (buffer.length < 4) return;
        len = buffer.readUInt16BE(2);
        offset = 4;
      } else if (len === 127) {
        if (buffer.length < 10) return;
        len = Number(buffer.readBigUInt64BE(2));
        offset = 10;
      }
      const masked = (buffer[1]! & 0x80) !== 0;
      const total = offset + (masked ? 4 : 0) + len;
      if (buffer.length < total) return;
      const mask = masked ? buffer.subarray(offset, offset + 4) : null;
      const payload = Buffer.from(buffer.subarray(total - len, total));
      if (mask) for (let i = 0; i < payload.length; i++) payload[i]! ^= mask[i % 4]!;
      buffer = buffer.subarray(total);

      if (opcode === 0x1) accepted.onMessage(payload.toString("utf8"));
      else if (opcode === 0x9) socket.write(encodeFrame(0xa, payload));
      else if (opcode === 0x8) {
        accepted.onClose();
        if (open) {
          open = false;
          socket.end(encodeFrame(0x8, payload.subarray(0, 2)));
        }
        return;
      }
    }
  });
  socket.on("close", () => {
    open = false;
    accepted.onClose();
  });
  socket.on("error", () => socket.destroy());
});

// ── Background traffic ─────────────────────────────────────────────────────

if (rateMs > 0) {
  let n = 0;
  setInterval(() => {
    n += 1;
    server.publish("oracle_update", {
      coverageType: n % 3,
      severity: "low",
      value: 0.99 + (n % 10) / 1000,
    });
  }, rateMs);
}
if (pingMs > 0) setInterval(() => server.ping(), pingMs);
if (restartEveryMs > 0) setInterval(() => server.restart(), restartEveryMs);

http.listen(port, "127.0.0.1", () => {
  console.log(`mock realtime server on http://127.0.0.1:${port} (scenario: ${scenarioName})`);
  console.log(`  ws://127.0.0.1:${port}/ws · GET /api/v1/realtime/poll · POST /__control`);
});
