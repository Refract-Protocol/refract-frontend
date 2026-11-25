#!/usr/bin/env node
/**
 * Dev server wrapper. Checks whether the default port is free and prints a
 * clear message when Next.js will auto-select a different one, so contributors
 * don't keep the stale browser tab open.
 *
 * Usage: node scripts/dev.mjs [--port <n>]  (default: 3000)
 * The npm "dev" script calls this instead of `next dev` directly.
 */
import { createServer } from "node:net";
import { spawn } from "node:child_process";

const portArg = process.argv.indexOf("--port");
const port = portArg !== -1 ? Number(process.argv[portArg + 1]) : 3000;

function isPortFree(p) {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => { server.close(); resolve(true); });
    server.listen(p, "127.0.0.1");
  });
}

const free = await isPortFree(port);
if (!free) {
  console.warn(
    `\x1b[33m⚠  Port ${port} is already in use.\x1b[0m`,
    `Next.js will pick the next available port.`,
    `Check the "ready on" line below for the actual URL.\n`
  );
}

const args = ["dev", ...process.argv.slice(2)];
const child = spawn("next", args, { stdio: "inherit", shell: true });
child.on("exit", (code) => process.exit(code ?? 0));
