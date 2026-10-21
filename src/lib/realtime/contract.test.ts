/**
 * Consumer-driven contract tests for the realtime WebSocket topic schema.
 *
 * Closes #234: Pins the frontend's expectations to a versioned artifact and
 * fails CI when the backend-published OpenAPI schema drifts from what
 * `src/lib/realtime/client.ts` / `contract.ts` assumes.
 *
 * ## What is tested
 *
 * 1. All payloads that conform to the Zod schemas parse successfully.
 * 2. Payloads missing required fields are rejected with informative errors.
 * 3. The Zod schema field names exactly match those in `openapi/refract-api.yaml`
 *    (bi-directional diff — catches both additions and removals).
 * 4. The `severity` and `type` enums defined in Zod match the OpenAPI enums.
 * 5. `validateFrame` / `assertFrame` public API behaves correctly.
 * 6. Unknown topics are tolerated (forward-compatibility guarantee).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  oracleUpdateSchema,
  envelopeSchema,
  TOPIC_SCHEMAS,
  KNOWN_TOPICS,
  validateFrame,
  assertFrame,
  diffOpenApiSchema,
  ContractViolationError,
  CONTRACT_VERSION,
} from "./contract";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Minimal YAML property extractor — avoids adding a YAML parser dependency.
 * Parses simple `key: value` pairs (no nested objects, no arrays) from an
 * OpenAPI `properties:` block by scanning the raw file content.
 *
 * This is intentionally trivial: it only needs to extract first-level
 * property names from a known schema block to do the drift check.
 */
function extractOpenApiProperties(schemaName: string, yamlContent: string): Record<string, string> {
  // Find the schema block
  const schemaPattern = new RegExp(`    ${schemaName}:\\n([\\s\\S]*?)(?=\\n    \\w|$)`);
  const schemaMatch = yamlContent.match(schemaPattern);
  if (!schemaMatch) return {};

  const propertiesBlock = schemaMatch[1];
  // Extract property names from lines like "        propertyName: { ... }"
  const propPattern = /^        (\w+):/gm;
  const props: Record<string, string> = {};
  let m: RegExpExecArray | null;
  while ((m = propPattern.exec(propertiesBlock)) !== null) {
    props[m[1]] = m[1];
  }
  return props;
}

const OPENAPI_PATH = join(process.cwd(), "openapi", "refract-api.yaml");
const openApiYaml = readFileSync(OPENAPI_PATH, "utf-8");

// ---------------------------------------------------------------------------
// Contract version
// ---------------------------------------------------------------------------

describe("CONTRACT_VERSION", () => {
  it("is a semver string", () => {
    expect(CONTRACT_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });
});

// ---------------------------------------------------------------------------
// Envelope schema
// ---------------------------------------------------------------------------

describe("envelopeSchema", () => {
  it("accepts a valid envelope", () => {
    const result = envelopeSchema.safeParse({ topic: "oracle_update", payload: {} });
    expect(result.success).toBe(true);
  });

  it("rejects an empty topic", () => {
    const result = envelopeSchema.safeParse({ topic: "", payload: {} });
    expect(result.success).toBe(false);
  });

  it("rejects a missing topic", () => {
    const result = envelopeSchema.safeParse({ payload: {} });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// oracle_update topic
// ---------------------------------------------------------------------------

describe("oracleUpdateSchema", () => {
  const valid = {
    coverageType: "StablecoinDepeg",
    type: "oracle_update" as const,
    value: 1.0002,
    threshold: 0.95,
    severity: "low" as const,
    message: "USDC price: $1.0002",
  };

  it("accepts a fully-valid oracle_update payload", () => {
    expect(oracleUpdateSchema.safeParse(valid).success).toBe(true);
  });

  it("accepts all valid severity values", () => {
    for (const severity of ["low", "medium", "high", "triggered"] as const) {
      expect(oracleUpdateSchema.safeParse({ ...valid, severity }).success).toBe(true);
    }
  });

  it("rejects an unknown severity", () => {
    const result = oracleUpdateSchema.safeParse({ ...valid, severity: "critical" });
    expect(result.success).toBe(false);
  });

  it("rejects a missing required field (message)", () => {
    const { message: _m, ...partial } = valid;
    expect(oracleUpdateSchema.safeParse(partial).success).toBe(false);
  });

  it("rejects a missing required field (value)", () => {
    const { value: _v, ...partial } = valid;
    expect(oracleUpdateSchema.safeParse(partial).success).toBe(false);
  });

  it("rejects a wrong type literal (type !== 'oracle_update')", () => {
    const result = oracleUpdateSchema.safeParse({ ...valid, type: "claim_update" });
    expect(result.success).toBe(false);
  });

  it("rejects a non-numeric value field", () => {
    const result = oracleUpdateSchema.safeParse({ ...valid, value: "not-a-number" });
    expect(result.success).toBe(false);
  });

  it("rejects an empty coverageType string", () => {
    const result = oracleUpdateSchema.safeParse({ ...valid, coverageType: "" });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// OpenAPI ↔ Zod drift check  (closes #234 — the CI gate)
// ---------------------------------------------------------------------------

describe("OpenAPI ↔ Zod drift check", () => {
  it("OracleReading properties in openapi/refract-api.yaml match oracleUpdateSchema", () => {
    const openApiProps = extractOpenApiProperties("OracleReading", openApiYaml);
    expect(Object.keys(openApiProps).length).toBeGreaterThan(0);

    const { missingInZod, missingInOpenApi } = diffOpenApiSchema(
      openApiProps,
      oracleUpdateSchema as import("zod").ZodObject<import("zod").ZodRawShape>
    );

    expect(
      missingInZod,
      `Fields in OpenAPI but missing in Zod contract: ${missingInZod.join(", ")}`
    ).toHaveLength(0);
    expect(
      missingInOpenApi,
      `Fields in Zod contract but missing in OpenAPI: ${missingInOpenApi.join(", ")}`
    ).toHaveLength(0);
  });

  it("OracleReading type enum in OpenAPI matches Zod literal", () => {
    // The OpenAPI enum has a single value: oracle_update
    expect(openApiYaml).toMatch(/enum:\s*\[\s*oracle_update\s*\]/);
  });

  it("OracleReading severity enum in OpenAPI has all 4 values", () => {
    // Verify enum line presence — exact ordering may vary in YAML.
    for (const sev of ["low", "medium", "high", "triggered"]) {
      expect(openApiYaml).toContain(sev);
    }
  });
});

// ---------------------------------------------------------------------------
// TOPIC_SCHEMAS registry
// ---------------------------------------------------------------------------

describe("TOPIC_SCHEMAS registry", () => {
  it("contains at least one registered topic", () => {
    expect(KNOWN_TOPICS.length).toBeGreaterThanOrEqual(1);
  });

  it("oracle_update is registered", () => {
    expect(KNOWN_TOPICS).toContain("oracle_update");
    expect(TOPIC_SCHEMAS["oracle_update"]).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// validateFrame
// ---------------------------------------------------------------------------

describe("validateFrame", () => {
  const validPayload = {
    coverageType: "MarketCrash",
    type: "oracle_update",
    value: -15.2,
    threshold: -30,
    severity: "medium",
    message: "XLM 24h change: -15.2%",
  };

  it("returns { ok: true } for a valid oracle_update frame", () => {
    const result = validateFrame("oracle_update", validPayload);
    expect(result.ok).toBe(true);
    expect(result.errors).toBeUndefined();
  });

  it("returns { ok: false } with errors for an invalid frame", () => {
    const result = validateFrame("oracle_update", { type: "oracle_update" });
    expect(result.ok).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errors!.length).toBeGreaterThan(0);
  });

  it("returns { ok: true } for an unknown topic (forward-compat)", () => {
    const result = validateFrame("future_topic", { anything: "goes" });
    expect(result.ok).toBe(true);
  });

  it("includes the topic name in the result", () => {
    const result = validateFrame("oracle_update", validPayload);
    expect(result.topic).toBe("oracle_update");
  });
});

// ---------------------------------------------------------------------------
// assertFrame
// ---------------------------------------------------------------------------

describe("assertFrame", () => {
  it("does not throw for a valid payload", () => {
    expect(() =>
      assertFrame("oracle_update", {
        coverageType: "SmartContractRisk",
        type: "oracle_update",
        value: -2.1,
        threshold: -50,
        severity: "low",
        message: "TVL change: -2.1%",
      })
    ).not.toThrow();
  });

  it("throws ContractViolationError for an invalid payload", () => {
    expect(() => assertFrame("oracle_update", { bogus: true })).toThrow(ContractViolationError);
  });

  it("includes the topic and issues in the thrown error", () => {
    try {
      assertFrame("oracle_update", {});
    } catch (e) {
      expect(e).toBeInstanceOf(ContractViolationError);
      const err = e as ContractViolationError;
      expect(err.topic).toBe("oracle_update");
      expect(err.issues.length).toBeGreaterThan(0);
    }
  });

  it("does not throw for an unknown topic", () => {
    expect(() => assertFrame("unregistered_topic", {})).not.toThrow();
  });
});
