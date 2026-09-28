/**
 * Named re-exports of the types generated from openapi/refract-api.yaml.
 * Don't edit schema.d.ts by hand — run `npm run api:generate`.
 */
import type { components } from "./schema";

export type ApiSchemas = components["schemas"];
