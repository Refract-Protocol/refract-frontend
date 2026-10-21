import { readFileSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";

const root = `${process.cwd()}/`;

describe("realtime protocol examples", () => {
  it("validates every documented payload against its named schema", () => {
    const schema = JSON.parse(readFileSync(`${root}docs/realtime.schema.json`, "utf8"));
    const markdown = readFileSync(`${root}docs/realtime-protocol.md`, "utf8");
    const examples = [...markdown.matchAll(/```json realtime-example:([^\n]+)\n([\s\S]*?)\n```/g)];
    const ajv = new Ajv2020({ strict: true, allErrors: true });
    addFormats(ajv);
    ajv.addSchema(schema);
    expect(examples.length).toBe(Object.keys(schema.$defs).length - 1);
    for (const [, definition, json] of examples) {
      const validate = ajv.getSchema(`${schema.$id}#/$defs/${definition}`);
      expect(validate, `missing schema ${definition}`).toBeTypeOf("function");
      const valid = validate?.(JSON.parse(json!));
      expect(validate?.errors, `${definition} schema errors`).toBeNull();
      expect(valid, definition).toBe(true);
    }
  });
});
