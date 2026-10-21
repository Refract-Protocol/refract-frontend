#!/usr/bin/env node
/**
 * Production-bundle assertions for the realtime layer (issue #248).
 * Run after `next build`; exits non-zero on any violation.
 *
 *  1. Dev/test tooling (src/lib/realtime/dev) never ships: no file under
 *     .next/static may contain the dev-only marker.
 *  2. The realtime client is lazy: it lives in the `realtime` chunk and in
 *     no chunk a route loads up front (per .next/app-build-manifest.json and
 *     .next/build-manifest.json).
 *
 * Usage: node scripts/check-realtime-bundle.mjs [nextDir]
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const NEXT_DIR = process.argv[2] ?? ".next";
const STATIC_DIR = join(NEXT_DIR, "static");

/** Exported from src/lib/realtime/dev/fakeSocket.ts. */
const DEV_ONLY_MARKER = "__REFRACT_REALTIME_DEV_ONLY__";
/** A property name that only src/lib/realtime/client.ts contains (minifiers keep it). */
const CLIENT_MARKER = "clientNoContextTakeover";

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

function readJson(path) {
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
}

if (!existsSync(STATIC_DIR)) {
  console.error(`✗ ${STATIC_DIR} not found — run \`next build\` first.`);
  process.exit(1);
}

const failures = [];
const jsFiles = walk(STATIC_DIR).filter((f) => f.endsWith(".js"));
const contents = new Map(jsFiles.map((f) => [f, readFileSync(f, "utf8")]));

// 1. Dev tooling must not ship.
for (const [file, code] of contents) {
  if (code.includes(DEV_ONLY_MARKER)) failures.push(`dev-only realtime code shipped in ${relative(NEXT_DIR, file)}`);
}

// 2. The client must be in the lazy chunk and nowhere a route loads eagerly.
const clientChunks = [...contents].filter(([, code]) => code.includes(CLIENT_MARKER)).map(([f]) => f);
const realtimeChunks = clientChunks.filter((f) => /[\\/]realtime[.-][^\\/]*\.js$/.test(f));
if (clientChunks.length === 0) {
  console.warn("! realtime client not found in any chunk (no route uses it yet?)");
} else if (realtimeChunks.length === 0) {
  failures.push(
    `realtime client found outside the named \`realtime\` chunk: ${clientChunks.map((f) => relative(NEXT_DIR, f)).join(", ")}. ` +
      "Load it with loadRealtime() from src/lib/realtime/load.ts.",
  );
}

const eager = new Set();
const appManifest = readJson(join(NEXT_DIR, "app-build-manifest.json"));
for (const files of Object.values(appManifest?.pages ?? {})) files.forEach((f) => eager.add(f));
const buildManifest = readJson(join(NEXT_DIR, "build-manifest.json"));
for (const key of ["rootMainFiles", "polyfillFiles", "lowPriorityFiles"]) (buildManifest?.[key] ?? []).forEach((f) => eager.add(f));
for (const files of Object.values(buildManifest?.pages ?? {})) files.forEach((f) => eager.add(f));

for (const file of eager) {
  const code = contents.get(join(NEXT_DIR, file));
  if (code?.includes(CLIENT_MARKER)) failures.push(`realtime client is in an eagerly loaded chunk: ${file}`);
}

if (failures.length) {
  console.error("✗ realtime bundle check failed:");
  failures.forEach((f) => console.error(`  - ${f}`));
  process.exit(1);
}
console.log(
  `✓ realtime bundle check passed (${realtimeChunks.map((f) => relative(NEXT_DIR, f)).join(", ") || "no realtime chunk"}; ` +
    `${eager.size} eager files scanned, no dev-only code shipped)`,
);
