#!/usr/bin/env tsx
/**
 * Client/server boundary audit.
 *
 * Ensures that modules which touch browser-only globals (window, document,
 * WebSocket, EventSource, sessionStorage, localStorage) are marked with the
 * `"use client"` directive so they are never evaluated during SSR or static
 * generation in the Next.js App Router.
 *
 * Realtime modules (issue #227) must additionally never touch those globals at
 * import time; they must defer access to effects / client-only entry points.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const SRC = join(ROOT, "src");

const BROWSER_GLOBALS = [
  "window",
  "document",
  "WebSocket",
  "EventSource",
  "sessionStorage",
  "localStorage",
  "navigator",
];

const REALTIME_PATHS = ["src/lib/realtime", "src/hooks/useRealtimeTopic"];

interface Violation {
  file: string;
  reason: string;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

function hasUseClientDirective(source: string): boolean {
  // The directive must be the first statement (allow leading comments/whitespace).
  const stripped = source.replace(/^\s*(\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*/, "");
  return /^["']use client["'];?/.test(stripped);
}

function referencesBrowserGlobal(source: string): boolean {
  return BROWSER_GLOBALS.some((name) =>
    new RegExp(`(^|[^\\w.$])${name}([^\\w$]|$)`).test(source),
  );
}

function isRealtimeModule(file: string): boolean {
  const rel = relative(ROOT, file).replace(/\\/g, "/");
  return REALTIME_PATHS.some((p) => rel === p || rel.startsWith(`${p}/`) || rel.startsWith(`${p}.`));
}

function main(): void {
  const violations: Violation[] = [];

  let files: string[] = [];
  try {
    files = walk(SRC);
  } catch {
    console.error(`[audit-client-boundaries] unable to read ${SRC}`);
    process.exit(1);
  }

  for (const file of files) {
    const source = readFileSync(file, "utf8");
    const rel = relative(ROOT, file).replace(/\\/g, "/");

    if (!referencesBrowserGlobal(source)) continue;

    if (!hasUseClientDirective(source)) {
      violations.push({
        file: rel,
        reason: "references browser globals but is missing the \"use client\" directive",
      });
    }

    if (isRealtimeModule(file)) {
      // Realtime modules must not touch browser globals at module scope.
      // A `"use client"` directive is required, and any direct global access
      // must be guarded (e.g. `typeof window !== "undefined"`) or deferred
      // into effects. We flag unguarded top-level references here.
      const unguarded = BROWSER_GLOBALS.some((name) => {
        const guarded = new RegExp(
          `typeof\\s+${name}\\s*!==?\\s*["']undefined["']`,
        ).test(source);
        return !guarded && new RegExp(`(^|[^\\w.$])${name}([^\\w$]|$)`).test(source);
      });
      if (unguarded) {
        violations.push({
          file: rel,
          reason:
            "realtime module accesses browser globals without an SSR-safe guard (typeof window !== \"undefined\")",
        });
      }
    }
  }

  if (violations.length > 0) {
    console.error("[audit-client-boundaries] boundary violations found:");
    for (const v of violations) {
      console.error(`  - ${v.file}: ${v.reason}`);
    }
    process.exit(1);
  }

  console.log(
    `[audit-client-boundaries] OK — checked ${files.length} files, no boundary violations.`,
  );
}

main();
