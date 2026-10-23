#!/usr/bin/env tsx
/**
 * Synthetic realtime canary. Env: REALTIME_CANARY_URL (required),
 * REALTIME_CANARY_TOPIC (default "canary"), REALTIME_CANARY_TOKEN (service token),
 * REALTIME_CANARY_ATTEMPTS (default 3), REALTIME_CANARY_TIMEOUT_MS (default 10000).
 * Prints one structured JSON line; exits 1 only if every attempt fails
 * (short failure threshold so a single transient miss doesn't alert).
 */
import { probeRealtime, type CanaryResult } from "../src/lib/realtime/canary";

async function main() {
  const url = process.env.REALTIME_CANARY_URL;
  if (!url) {
    console.error(
      JSON.stringify({ ok: false, failure: "endpoint", error: "REALTIME_CANARY_URL is not set" })
    );
    process.exit(1);
  }
  const attempts = Number(process.env.REALTIME_CANARY_ATTEMPTS ?? 3);
  let last: CanaryResult | undefined;
  for (let i = 1; i <= attempts; i++) {
    last = await probeRealtime({
      url,
      topic: process.env.REALTIME_CANARY_TOPIC ?? "canary",
      token: process.env.REALTIME_CANARY_TOKEN,
      timeoutMs: Number(process.env.REALTIME_CANARY_TIMEOUT_MS ?? 10_000),
    });
    console.log(JSON.stringify({ ...last, attempt: i, ts: new Date().toISOString() }));
    if (last.ok) return;
  }
  process.exit(1);
}

void main();
