#!/usr/bin/env node
/**
 * Token drift guard.
 *
 * Parses the authoritative CSS custom properties in `src/app/globals.css` and
 * the Tailwind theme in `tailwind.config.ts`, then fails when a token is
 * declared in both places with conflicting values.
 *
 * The single source of truth is `src/app/globals.css`; `tailwind.config.ts`
 * must reference tokens via `var(--pm-*)` (optionally wrapped in `rgb(...)`
 * for `<alpha-value>` support) instead of hardcoding raw colour values.
 *
 * Usage: `npm run tokens:check`
 *
 * @returns {void}
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const CSS_PATH = resolve(root, "src/app/globals.css");
const TAILWIND_PATH = resolve(root, "tailwind.config.ts");

/**
 * Normalise a CSS colour/value so cosmetic differences do not trigger false
 * positives (whitespace, casing, `0.5` vs `.5`).
 *
 * @param {string} value
 * @returns {string}
 */
function normalise(value) {
  return value
    .replace(/\s+/g, "")
    .replace(/0\.(\d+)/g, ".$1")
    .toLowerCase();
}

/**
 * Extract `--pm-*` custom properties from a CSS source string.
 *
 * @param {string} css
 * @returns {Map<string, string>}
 */
function parseCssTokens(css) {
  const tokens = new Map();
  const re = /(--pm-[\w-]+)\s*:\s*([^;]+);/g;
  let match;
  while ((match = re.exec(css)) !== null) {
    tokens.set(match[1], match[2].trim());
  }
  return tokens;
}

/**
 * Extract `pm-*` theme entries from the Tailwind config source string.
 *
 * @param {string} config
 * @returns {Map<string, string>}
 */
function parseTailwindTokens(config) {
  const tokens = new Map();
  const re = /["']?(pm-[\w-]+)["']?\s*:\s*["']([^"']+)["']/g;
  let match;
  while ((match = re.exec(config)) !== null) {
    tokens.set(match[1], match[2].trim());
  }
  return tokens;
}

/**
 * Resolve a Tailwind token value to the CSS custom property it references, if
 * any. Values such as `var(--pm-border)` or `rgb(var(--pm-border) / <alpha-value>)`
 * are considered references and never drift.
 *
 * @param {string} value
 * @returns {string | null}
 */
function referencedVar(value) {
  const match = value.match(/var\((--pm-[\w-]+)/);
  return match ? match[1] : null;
}

function main() {
  const css = readFileSync(CSS_PATH, "utf8");
  const config = readFileSync(TAILWIND_PATH, "utf8");

  const cssTokens = parseCssTokens(css);
  const tailwindTokens = parseTailwindTokens(config);

  const errors = [];

  for (const [name, value] of tailwindTokens) {
    const ref = referencedVar(value);
    if (ref) {
      if (!cssTokens.has(ref)) {
        errors.push(
          `tailwind.config.ts: "${name}" references ${ref}, which is not defined in globals.css`,
        );
      }
      continue;
    }

    const cssValue = cssTokens.get(name);
    if (cssValue !== undefined && normalise(cssValue) !== normalise(value)) {
      errors.push(
        `Token drift for "${name}": globals.css has "${cssValue}" but tailwind.config.ts has "${value}"`,
      );
    }
  }

  if (errors.length > 0) {
    console.error("Design-token drift detected:\n");
    for (const error of errors) {
      console.error(`  - ${error}`);
    }
    console.error(
      "\nMake globals.css the single source of truth and reference tokens via var(--pm-*) in tailwind.config.ts.",
    );
    process.exit(1);
  }

  console.log(
    `tokens:check passed (${cssTokens.size} CSS tokens, ${tailwindTokens.size} Tailwind tokens).`,
  );
}

main();
