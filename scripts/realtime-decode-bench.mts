/**
 * Load/soak harness for realtime frame decoding (issue #242).
 *
 *   npm run bench:realtime                       # default: 2s per case
 *   npm run bench:realtime -- --seconds 10       # longer soak
 *
 * For each payload profile it replays a high-frequency stream two ways and
 * reports how busy the *main* thread was:
 *   - main:   decodeFrame() on the main thread (the pre-#242 behaviour)
 *   - worker: frames posted to a worker running the same decodeFrame()
 *
 * "Main-thread busy %" is Node's event-loop utilization over the run — the
 * share of wall time the main thread could not spend on anything else (in
 * the browser: painting and input). "p95 burst ms" is the synchronous time
 * one burst of frames held the main thread.
 */
import { performance } from "node:perf_hooks";
import { Worker, isMainThread, parentPort } from "node:worker_threads";
import { decodeFrame } from "../src/lib/realtime/decode";

interface Profile {
  name: string;
  ratePerSec: number;
  make: (seq: number) => string;
}

function oracleFrame(seq: number, readings: number): string {
  return JSON.stringify({
    topic: "oracle_update",
    id: `oracle-${seq}`,
    seq,
    payload: {
      readings: Array.from({ length: readings }, (_, i) => ({
        coverageType: i % 4,
        feed: `USDC/USD#${i}`,
        severity: ["low", "medium", "high"][i % 3],
        value: 0.99 + ((seq + i) % 100) / 10_000,
        confidence: 0.98,
        updatedAt: new Date(1_700_000_000_000 + seq * 250).toISOString(),
        source: "reflector",
      })),
    },
  });
}

const PROFILES: Profile[] = [
  {
    name: "oracle tick (1 reading, ~0.3 KB) @ 500/s",
    ratePerSec: 500,
    make: (s) => oracleFrame(s, 1),
  },
  {
    name: "oracle batch (40 readings, ~8 KB) @ 200/s",
    ratePerSec: 200,
    make: (s) => oracleFrame(s, 40),
  },
  {
    name: "pool snapshot (250 rows, ~50 KB) @ 40/s",
    ratePerSec: 40,
    make: (s) => oracleFrame(s, 250),
  },
];

const BURSTS_PER_SEC = 50; // frames arrive in bursts, as they do off a socket

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? Number(process.argv[i + 1]) : fallback;
}

function p95(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length * 0.95)] ?? 0;
}

async function run(profile: Profile, mode: "main" | "worker", seconds: number) {
  const frames = Array.from({ length: profile.ratePerSec * seconds }, (_, i) =>
    profile.make(i + 1)
  );
  const perBurst = Math.max(1, Math.round(profile.ratePerSec / BURSTS_PER_SEC));
  const worker = mode === "worker" ? new Worker(new URL(import.meta.url)) : null;
  let received = 0;
  let failures = 0;
  const done = new Promise<void>((resolve) => {
    if (!worker) return;
    worker.on("message", ({ result }) => {
      if (!result.ok) failures += 1;
      if (++received === frames.length) resolve();
    });
  });
  if (worker) {
    // Warm up so worker start-up is not billed to the steady state.
    worker.postMessage({ id: 0, raw: profile.make(0) });
    await new Promise((r) => worker.once("message", r));
  }

  const bursts: number[] = [];
  const elu0 = performance.eventLoopUtilization();
  const t0 = performance.now();
  for (let i = 0; i < frames.length; i += perBurst) {
    const start = performance.now();
    for (const raw of frames.slice(i, i + perBurst)) {
      if (worker) worker.postMessage({ id: i, raw });
      else if (!decodeFrame(raw).ok) failures += 1;
    }
    bursts.push(performance.now() - start);
    await new Promise((r) => setTimeout(r, 1_000 / BURSTS_PER_SEC));
  }
  if (worker) await done;
  const elu = performance.eventLoopUtilization(elu0);
  const wall = performance.now() - t0;
  await worker?.terminate();

  return {
    busyPct: elu.utilization * 100,
    p95BurstMs: p95(bursts),
    wallMs: wall,
    failures,
  };
}

async function main() {
  const seconds = arg("seconds", 2);
  console.log(`Realtime decode bench · ${seconds}s per case · Node ${process.version}\n`);
  const rows: string[][] = [["profile", "path", "main-thread busy %", "p95 burst ms", "invalid"]];
  for (const profile of PROFILES) {
    for (const mode of ["main", "worker"] as const) {
      const r = await run(profile, mode, seconds);
      rows.push([
        profile.name,
        mode,
        r.busyPct.toFixed(1),
        r.p95BurstMs.toFixed(3),
        String(r.failures),
      ]);
    }
  }
  const widths = rows[0]!.map((_, c) => Math.max(...rows.map((row) => row[c]!.length)));
  for (const [i, row] of rows.entries()) {
    console.log(row.map((cell, c) => cell.padEnd(widths[c]!)).join("  "));
    if (i === 0) console.log(widths.map((w) => "-".repeat(w)).join("  "));
  }
}

// The same file is the worker entry: workers decode, the main thread drives.
if (!isMainThread) {
  parentPort!.on("message", ({ id, raw }: { id: number; raw: string }) => {
    parentPort!.postMessage({ id, result: decodeFrame(raw) });
  });
} else {
  void main();
}
