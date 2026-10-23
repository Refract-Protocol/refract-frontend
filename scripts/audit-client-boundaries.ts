#!/usr/bin/env tsx
/**
 * Informational audit of the Next.js App Router client/server boundary.
 *
 * Lists every `"use client"` file under src/app and src/components, flags
 * which top-level page/layout boundaries are client components, and estimates
 * how much of each file is genuinely interactive (hooks, event handlers,
 * browser APIs). A client file with zero such signals is a candidate to become
 * a server component. A heavily interactive page being fully client-rendered
 * is usually correct — the report says so rather than implying a problem.
 *
 * Usage: tsx scripts/audit-client-boundaries.ts [--out report.md]
 * Always exits 0; this is visibility, not a gate.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

export interface FileAudit {
  file: string;
  lines: number;
  signals: number;
  /** Share of non-blank lines carrying an interactivity signal (a rough lower bound). */
  interactiveShare: number;
  topLevel: boolean;
  verdict: "interactive" | "candidate-for-server";
}

const SIGNAL =
  /\buse[A-Z]\w*\s*\(|\bon[A-Z]\w*\s*=\s*\{|\b(window|document|localStorage|sessionStorage|navigator)\b/;
const TOP_LEVEL = /(^|\/)(page|layout)\.tsx$/;

/** True when the first statement of the file is a "use client" directive (comments allowed before it). */
export function hasUseClient(source: string): boolean {
  const stripped = source.replace(/^\s*(\/\*[\s\S]*?\*\/|\/\/[^\n]*\n|\s)*/, "");
  return /^(["'])use client\1/.test(stripped);
}

export function auditSource(file: string, source: string): FileAudit | null {
  if (!hasUseClient(source)) return null;
  const nonBlank = source.split("\n").filter((l) => l.trim() !== "");
  const signals = nonBlank.filter((l) => SIGNAL.test(l)).length;
  return {
    file,
    lines: nonBlank.length,
    signals,
    interactiveShare: nonBlank.length ? signals / nonBlank.length : 0,
    topLevel: TOP_LEVEL.test(file),
    verdict: signals > 0 ? "interactive" : "candidate-for-server",
  };
}

export function listSourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return listSourceFiles(full);
    return /\.tsx$/.test(name) && !/\.test\.tsx$/.test(name) ? [full] : [];
  });
}

export function renderReport(audits: FileAudit[]): string {
  const pct = (n: number) => `${(n * 100).toFixed(0)}%`;
  const row = (a: FileAudit) =>
    `| \`${a.file}\` | ${a.lines} | ${a.signals} | ${pct(a.interactiveShare)} | ${a.verdict} |`;
  const header =
    "| File | Lines | Interactive lines | Share | Verdict |\n| --- | ---: | ---: | ---: | --- |";
  const top = audits.filter((a) => a.topLevel);
  const candidates = audits.filter((a) => a.verdict === "candidate-for-server");
  return [
    "# Client boundary audit",
    "",
    `${audits.length} client files; ${top.length} are top-level page/layout boundaries; ${candidates.length} show no interactivity signals.`,
    "",
    "## Top-level page/layout boundaries",
    top.length ? `${header}\n${top.map(row).join("\n")}` : "None.",
    "",
    "## Client files with no interactivity signals (candidates for server components)",
    candidates.length
      ? `${header}\n${candidates.map(row).join("\n")}`
      : "None — every client file uses hooks, handlers or browser APIs.",
    "",
    "## All client files",
    `${header}\n${audits.map(row).join("\n")}`,
    "",
    "_Heuristic: hooks, `onX={…}` handlers and window/document/storage access count as interactive. A fully client-rendered page that is heavily interactive is expected, not a defect._",
    "",
  ].join("\n");
}

export function runAudit(root = process.cwd()): FileAudit[] {
  return ["src/app", "src/components"]
    .flatMap((d) => listSourceFiles(join(root, d)))
    .map((f) => auditSource(relative(root, f), readFileSync(f, "utf8")))
    .filter((a): a is FileAudit => a !== null)
    .sort((a, b) => a.file.localeCompare(b.file));
}

if (process.argv[1]?.endsWith("audit-client-boundaries.ts")) {
  const report = renderReport(runAudit());
  const out = process.argv.indexOf("--out");
  if (out !== -1 && process.argv[out + 1]) writeFileSync(process.argv[out + 1], report);
  console.log(report);
}
