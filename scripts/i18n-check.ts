#!/usr/bin/env tsx
/**
 * i18n-readiness CI checks.
 *
 * Two modes:
 *
 *   1. check (default)  — scan the source tree for `t("...")` call sites and
 *                         fail the build if a referenced key is missing from
 *                         the base locale file, or if a key is referenced
 *                         dynamically (flagged for manual review).
 *
 *   2. extract          — regenerate the base locale key set from the source
 *                         tree and diff it against the committed locale file,
 *                         flagging missing and orphaned keys.
 *
 * Usage:
 *   tsx scripts/i18n-check.ts            # check (CI)
 *   tsx scripts/i18n-check.ts extract    # extraction / diff report
 *   tsx scripts/i18n-check.ts --help
 *
 * Dynamic keys (e.g. `t(\`nav.${section}\`)` or `t(someVar)`) cannot be
 * resolved statically. They are reported as warnings for manual review and do
 * not crash the scanner.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const ROOT = resolve(__dirname, "..");
const SRC_DIR = join(ROOT, "src");
const LOCALE_FILE = join(ROOT, "src", "locales", "en.json");
const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx"];
const IGNORED_DIRS = new Set(["node_modules", ".next", "dist", "build", "coverage"]);

/** Matches `t("some.key")` and `t('some.key')` with an optional namespace arg. */
const STATIC_KEY_RE = /\bt\(\s*(['"])([^'"\\]+)\1\s*(?:,|\))/g;
/** Matches `t(`...`)` template literals that contain interpolation. */
const DYNAMIC_TEMPLATE_RE = /\bt\(\s*`([^`]*)`\s*(?:,|\))/g;
/** Matches `t(identifier)` / `t(expr)` calls that are not string literals. */
const DYNAMIC_EXPR_RE = /\bt\(\s*([A-Za-z_$][\w$]*)\s*(?:,|\))/g;

interface ScanResult {
  staticKeys: Map<string, string[]>;
  dynamic: string[];
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (IGNORED_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walk(full, out);
    } else if (SOURCE_EXTENSIONS.includes(entry.slice(entry.lastIndexOf(".")))) {
      out.push(full);
    }
  }
  return out;
}

function lineOf(source: string, index: number): number {
  return source.slice(0, index).split("\n").length;
}

/**
 * Extract every `t("...")` key from a source string.
 * Exported for unit testing.
 */
export function extractKeys(source: string): { keys: string[]; dynamic: string[] } {
  const keys: string[] = [];
  const dynamic: string[] = [];

  for (const match of source.matchAll(STATIC_KEY_RE)) {
    keys.push(match[2]);
  }

  for (const match of source.matchAll(DYNAMIC_TEMPLATE_RE)) {
    if (match[1].includes("${")) {
      dynamic.push(match[1]);
    } else if (match[1].length > 0) {
      keys.push(match[1]);
    }
  }

  for (const match of source.matchAll(DYNAMIC_EXPR_RE)) {
    dynamic.push(match[1]);
  }

  return { keys, dynamic };
}

/** Flatten a nested locale object into dotted key paths. Exported for tests. */
export function flattenKeys(obj: Record<string, unknown>, prefix = ""): string[] {
  const out: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      out.push(...flattenKeys(value as Record<string, unknown>, path));
    } else {
      out.push(path);
    }
  }
  return out;
}

function loadLocaleKeys(): Set<string> {
  const raw = JSON.parse(readFileSync(LOCALE_FILE, "utf8")) as Record<string, unknown>;
  return new Set(flattenKeys(raw));
}

function scanSource(): ScanResult {
  const staticKeys = new Map<string, string[]>();
  const dynamic: string[] = [];

  for (const file of walk(SRC_DIR)) {
    const source = readFileSync(file, "utf8");
    const rel = relative(ROOT, file);
    const { keys, dynamic: dyn } = extractKeys(source);

    for (const key of keys) {
      const locations = staticKeys.get(key) ?? [];
      locations.push(rel);
      staticKeys.set(key, locations);
    }

    for (const expr of dyn) {
      const index = source.indexOf(expr);
      dynamic.push(`${rel}:${index >= 0 ? lineOf(source, index) : 0} -> t(${expr})`);
    }
  }

  return { staticKeys, dynamic };
}

function runCheck(): number {
  const localeKeys = loadLocaleKeys();
  const { staticKeys, dynamic } = scanSource();

  const missing: string[] = [];
  for (const key of staticKeys.keys()) {
    if (!localeKeys.has(key)) missing.push(key);
  }

  if (dynamic.length > 0) {
    console.warn("\n[i18n-check] Dynamically-constructed keys require manual review:");
    for (const entry of dynamic) console.warn(`  - ${entry}`);
  }

  if (missing.length > 0) {
    console.error("\n[i18n-check] Missing translation keys in src/locales/en.json:");
    for (const key of missing.sort()) {
      console.error(`  - ${key} (referenced in ${staticKeys.get(key)!.join(", ")})`);
    }
    console.error("\nAdd the missing keys to src/locales/en.json or remove the stale references.\n");
    return 1;
  }

  console.log(`[i18n-check] OK — ${staticKeys.size} referenced key(s) resolved against the base locale.`);
  return 0;
}

function runExtract(): number {
  const localeKeys = loadLocaleKeys();
  const { staticKeys, dynamic } = scanSource();

  const referenced = new Set(staticKeys.keys());
  const missing = [...referenced].filter((k) => !localeKeys.has(k)).sort();
  const orphaned = [...localeKeys].filter((k) => !referenced.has(k)).sort();

  console.log(`[i18n-extract] ${referenced.size} key(s) referenced in source.`);
  console.log(`[i18n-extract] ${localeKeys.size} key(s) present in src/locales/en.json.`);

  if (missing.length > 0) {
    console.log("\nMissing from locale (referenced in code):");
    for (const key of missing) console.log(`  - ${key}`);
  }
  if (orphaned.length > 0) {
    console.log("\nOrphaned in locale (not referenced in code):");
    for (const key of orphaned) console.log(`  - ${key}`);
  }
  if (dynamic.length > 0) {
    console.log("\nDynamic keys (manual review):");
    for (const entry of dynamic) console.log(`  - ${entry}`);
  }
  if (missing.length === 0 && orphaned.length === 0) {
    console.log("\n[i18n-extract] Locale and source are in sync.");
  }

  return missing.length > 0 ? 1 : 0;
}

function main(): void {
  const mode = process.argv[2] ?? "check";
  if (mode === "--help" || mode === "-h") {
    console.log("Usage: tsx scripts/i18n-check.ts [check|extract]");
    process.exit(0);
  }
  const code = mode === "extract" ? runExtract() : runCheck();
  process.exit(code);
}

if (require.main === module) {
  main();
}
