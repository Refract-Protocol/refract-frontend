#!/usr/bin/env node
/**
 * Dependency-free mock realtime server implementing docs/realtime-protocol.md.
 * Dev/CI only — never imported by the app. Binds to an ephemeral port by default
 * and prints `MOCK_REALTIME_URL=ws://127.0.0.1:<port>/ws`.
 *
 * Scenarios are driven by one config object, from CLI flags (`--dropAfter=3`) or
 * per-connection query params (`ws://…/ws?dropAfter=3&duplicate=1`):
 *   seed, count (frames/topic, default 5), dropAfter (close after N frames),
 *   latencyMs, duplicate, reorder, unknown (emit unknown topic/version frames),
 *   authFail (close 4401). Payloads are seeded; timestamps are synthetic
 *   (BASE_TS + seq * 1000), so output is identical run to run.
 */
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const BASE_TS = 1_700_000_000_000;
const TOPICS = ["oracle", "claims", "pool", "notifications"];
const DEFAULTS = {
  seed: 1,
  count: 5,
  dropAfter: 0,
  latencyMs: 0,
  duplicate: false,
  reorder: false,
  unknown: false,
  authFail: false,
};

function mulberry32(a) {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const num = (v, d) => (v === undefined || v === "" || Number.isNaN(Number(v)) ? d : Number(v));
const bool = (v, d) => (v === undefined ? d : v === true || v === "1" || v === "true");

/** Merges defaults ← base ← overrides (string or typed values) into a normalized scenario. */
export function resolveScenario(...layers) {
  const raw = Object.assign({}, ...layers);
  return {
    seed: num(raw.seed, DEFAULTS.seed),
    count: num(raw.count, DEFAULTS.count),
    dropAfter: num(raw.dropAfter, DEFAULTS.dropAfter),
    latencyMs: num(raw.latencyMs, DEFAULTS.latencyMs),
    duplicate: bool(raw.duplicate, DEFAULTS.duplicate),
    reorder: bool(raw.reorder, DEFAULTS.reorder),
    unknown: bool(raw.unknown, DEFAULTS.unknown),
    authFail: bool(raw.authFail, DEFAULTS.authFail),
  };
}

function payloadFor(topic, seq, rnd) {
  const ts = BASE_TS + seq * 1000;
  const n = Math.floor(rnd() * 1_000_000);
  switch (topic) {
    case "oracle":
      return { id: `feed-${seq % 2}`, price: (n / 10000).toFixed(4), updatedAt: ts };
    case "claims":
      return {
        id: `claim-${seq}`,
        policyId: `policy-${n % 3}`,
        status: ["pending", "approved", "paid"][n % 3],
        amount: String(n),
        updatedAt: ts,
      };
    case "pool":
      return { id: "pool-0", tvl: String(n * 100), utilization: (n % 100) / 100, updatedAt: ts };
    default:
      return { id: `note-${seq}`, kind: "info", message: `Notification ${seq}`, createdAt: ts };
  }
}

/** The frames a subscriber to `topic` receives, in documented order. Pure and deterministic. */
export function framesFor(topic, scenario, cursor = 0) {
  const rnd = mulberry32(scenario.seed + TOPICS.indexOf(topic) * 7919);
  let frames = [];
  for (let seq = 1; seq <= scenario.count; seq++) {
    const payload = payloadFor(topic, seq, rnd);
    if (seq > cursor) frames.push({ v: 1, topic, seq, ts: BASE_TS + seq * 1000, payload });
  }
  if (scenario.reorder) {
    for (let i = 0; i + 1 < frames.length; i += 2)
      [frames[i], frames[i + 1]] = [frames[i + 1], frames[i]];
  }
  if (scenario.duplicate) frames = frames.flatMap((f) => [f, f]);
  if (scenario.unknown && frames.length) {
    frames.splice(
      1,
      0,
      { v: 1, topic: "mystery", seq: 1, ts: BASE_TS, payload: {} },
      { v: 99, topic, seq: 1, ts: BASE_TS, payload: {} }
    );
  }
  return frames;
}

function encode(text) {
  const body = Buffer.from(text);
  const len = body.length;
  const head = len < 126 ? Buffer.from([0x81, len]) : Buffer.from([0x81, 126, len >> 8, len & 255]);
  return Buffer.concat([head, body]);
}

function closeFrame(code) {
  return Buffer.from([0x88, 2, code >> 8, code & 255]);
}

/** Decodes complete client frames from `buf`; returns [frames, remaining]. */
function decode(buf) {
  const out = [];
  while (buf.length >= 2) {
    const opcode = buf[0] & 15;
    let len = buf[1] & 127;
    let off = 2;
    if (len === 126) {
      if (buf.length < 4) break;
      len = buf.readUInt16BE(2);
      off = 4;
    }
    const masked = (buf[1] & 128) !== 0;
    const end = off + (masked ? 4 : 0) + len;
    if (buf.length < end) break;
    const data = Buffer.from(buf.subarray(end - len, end));
    if (masked) for (let i = 0; i < len; i++) data[i] ^= buf[off + (i % 4)];
    out.push({ opcode, data });
    buf = buf.subarray(end);
  }
  return [out, buf];
}

/**
 * Starts the server. `port: 0` (default) picks a free port. Resolves with
 * `{ url, port, connections(), close() }`.
 */
export async function startMockRealtimeServer({
  port = 0,
  host = "127.0.0.1",
  scenario = {},
} = {}) {
  const base = resolveScenario(scenario);
  let connections = 0;
  const sockets = new Set();
  const server = createServer((_, res) => {
    res.writeHead(426).end("websocket only");
  });

  server.on("upgrade", (req, socket) => {
    const key = req.headers["sec-websocket-key"];
    if (!key) return socket.destroy();
    const url = new URL(req.url, "http://x");
    const sc = resolveScenario(base, Object.fromEntries(url.searchParams));
    const accept = createHash("sha1")
      .update(key + GUID)
      .digest("base64");
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`
    );
    connections++;
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => {});

    if (sc.authFail) {
      socket.end(closeFrame(4401));
      return;
    }

    let pending = Buffer.alloc(0);
    let sent = 0;
    let dropped = false;
    const timers = new Set();
    socket.on("close", () => timers.forEach(clearTimeout));

    const emit = (frames) => {
      frames.forEach((f, i) => {
        const t = setTimeout(
          () => {
            timers.delete(t);
            if (dropped || socket.destroyed) return;
            socket.write(encode(JSON.stringify(f)));
            sent++;
            if (sc.dropAfter && sent >= sc.dropAfter) {
              dropped = true;
              socket.destroy();
            }
          },
          sc.latencyMs * (i + 1)
        );
        timers.add(t);
      });
    };

    socket.on("data", (chunk) => {
      let frames;
      [frames, pending] = decode(Buffer.concat([pending, chunk]));
      for (const { opcode, data } of frames) {
        if (opcode === 8) return socket.end(closeFrame(1000));
        if (opcode === 9) continue;
        let msg;
        try {
          msg = JSON.parse(data.toString());
        } catch {
          continue;
        }
        if (msg.op === "ping") socket.write(encode('{"op":"pong"}'));
        else if (msg.op === "subscribe" && TOPICS.includes(msg.topic))
          emit(framesFor(msg.topic, sc, Number(msg.cursor) || 0));
      }
    });
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });
  const bound = server.address().port;
  return {
    port: bound,
    url: `ws://${host}:${bound}/ws`,
    connections: () => connections,
    close: () =>
      new Promise((resolve) => {
        sockets.forEach((s) => s.destroy());
        server.close(() => resolve());
      }),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const flags = Object.fromEntries(
    process.argv
      .slice(2)
      .filter((a) => a.startsWith("--"))
      .map((a) => {
        const [k, v = "1"] = a.slice(2).split("=");
        return [k, v];
      })
  );
  const { port, ...scenario } = flags;
  const srv = await startMockRealtimeServer({
    port: Number(port ?? process.env.MOCK_REALTIME_PORT ?? 0),
    scenario,
  });
  console.log(`MOCK_REALTIME_URL=${srv.url}`);
  const stop = () => srv.close().then(() => process.exit(0));
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}
