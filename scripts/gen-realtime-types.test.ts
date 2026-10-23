import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("realtime type generator", () => {
  it("fails loudly when the OpenAPI document omits a realtime schema", () => {
    const script = resolve(process.cwd(), "scripts/gen-realtime-types.mjs");
    const fixture = resolve(process.cwd(), "scripts/fixtures/malformed-openapi.yaml");
    const result = spawnSync(process.execPath, [script], {
      env: { ...process.env, REALTIME_OPENAPI_SPEC: fixture },
      encoding: "utf8",
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/Required realtime schema/);
  });
});
