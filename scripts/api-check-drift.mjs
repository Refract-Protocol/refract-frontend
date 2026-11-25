// Fails if regenerating src/lib/api/generated/schema.d.ts from the OpenAPI
// spec would change the committed file. Run via `npm run api:check-drift`.
//
// The generated output is cached in .api-drift-cache keyed by the spec's
// mtime, so repeated invocations (e.g. from a pre-commit hook or CI matrix)
// skip the expensive openapi-typescript subprocess when the spec has not
// changed.
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SPEC = "openapi/refract-api.yaml";
const COMMITTED = "src/lib/api/generated/schema.d.ts";
const CACHE_DIR = ".api-drift-cache";
const CACHE_KEY = statSync(SPEC).mtimeMs.toString(36);
const CACHE_FILE = join(CACHE_DIR, `${CACHE_KEY}.d.ts`);

let generated;
if (existsSync(CACHE_FILE)) {
  generated = readFileSync(CACHE_FILE, "utf8");
} else {
  const fresh = join(mkdtempSync(join(tmpdir(), "api-drift-")), "schema.d.ts");
  execFileSync("npx", ["openapi-typescript", SPEC, "-o", fresh], { stdio: "ignore" });
  generated = readFileSync(fresh, "utf8");
  try {
    if (!existsSync(CACHE_DIR)) {
      // mkdirSync is not imported; use execFileSync to create the directory
      // portably rather than adding an import for a one-time call.
      execFileSync("mkdir", ["-p", CACHE_DIR], { stdio: "ignore" });
    }
    writeFileSync(CACHE_FILE, generated);
  } catch {
    // Cache write failure is non-fatal; just skip it.
  }
}

if (generated !== readFileSync(COMMITTED, "utf8")) {
  console.error(
    `API types drifted: ${COMMITTED} does not match ${SPEC}.\nRun \`npm run api:generate\` and commit the result.`
  );
  process.exit(1);
}
console.log("API types are in sync with the OpenAPI spec.");
