#!/usr/bin/env node
/**
 * Realtime canary.
 *
 * Connects to the realtime endpoint, waits for a heartbeat, and emits a named
 * alert on any transport failure. Exits non-zero when any transport failure
 * occurs so it can be used as a CI gate.
 */

const ENDPOINT = process.env.REALTIME_CANARY_ENDPOINT ?? "ws://localhost:8787";
const HEARTBEAT_TIMEOUT_MS = Number(
  process.env.REALTIME_CANARY_TIMEOUT_MS ?? 5000,
);

const ALERTS = {
  connectFailed: "realtime_canary_connect_failed",
  heartbeatTimeout: "realtime_canary_heartbeat_timeout",
  transportError: "realtime_canary_transport_error",
} as const;

let failures = 0;

function emitAlert(name: string, detail: string): void {
  failures += 1;
  console.error(`[ALERT] ${name}: ${detail}`);
}

async function run(): Promise<void> {
  let socket: WebSocket;
  try {
    socket = new WebSocket(ENDPOINT);
  } catch (err) {
    emitAlert(ALERTS.connectFailed, `could not open socket: ${String(err)}`);
    return;
  }

  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };

    const timer = setTimeout(() => {
      emitAlert(
        ALERTS.heartbeatTimeout,
        `no heartbeat within ${HEARTBEAT_TIMEOUT_MS}ms`,
      );
      try {
        socket.close();
      } catch {
        /* ignore */
      }
      finish();
    }, HEARTBEAT_TIMEOUT_MS);

    socket.addEventListener("open", () => {
      console.log(`[canary] connected to ${ENDPOINT}`);
    });

    socket.addEventListener("message", (event) => {
      try {
        const msg = JSON.parse(String(event.data)) as { type?: string };
        if (msg.type === "heartbeat") {
          console.log("[canary] heartbeat received");
          try {
            socket.close();
          } catch {
            /* ignore */
          }
          finish();
        }
      } catch {
        /* ignore non-JSON frames */
      }
    });

    socket.addEventListener("error", (event) => {
      emitAlert(ALERTS.transportError, `transport error: ${String(event)}`);
      finish();
    });

    socket.addEventListener("close", (event) => {
      if (!settled && !event.wasClean) {
        emitAlert(
          ALERTS.transportError,
          `socket closed unexpectedly (code ${event.code})`,
        );
      }
      finish();
    });
  });
}

run()
  .catch((err) => {
    emitAlert(ALERTS.transportError, `unhandled failure: ${String(err)}`);
  })
  .finally(() => {
    if (failures > 0) {
      console.error(`[canary] FAILED with ${failures} transport failure(s)`);
      process.exit(1);
    }
    console.log("[canary] OK");
    process.exit(0);
  });
