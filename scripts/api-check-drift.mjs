// Fails if regenerating src/lib/api/generated/schema.d.ts from the OpenAPI
// spec would change the committed file. Run via `npm run api:check-drift`.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SPEC = "openapi/refract-api.yaml";
const COMMITTED = "src/lib/api/generated/schema.d.ts";
const fresh = join(mkdtempSync(join(tmpdir(), "api-drift-")), "schema.d.ts");

execFileSync("npx", ["openapi-typescript", SPEC, "-o", fresh], { stdio: "ignore" });

if (readFileSync(fresh, "utf8") !== readFileSync(COMMITTED, "utf8")) {
  console.error(`API types drifted: ${COMMITTED} does not match ${SPEC}.\nRun \`npm run api:generate\` and commit the result.`);
  process.exit(1);
}
console.log("API types are in sync with the OpenAPI spec.");
