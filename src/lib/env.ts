import { z } from "zod";

/** Treats an empty string (e.g. `NEXT_PUBLIC_X=` in .env) the same as unset. */
const blankToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

const urlWithProtocol = (protocols: string[]) =>
  z.string().refine(
    (v) => {
      try {
        return protocols.includes(new URL(v).protocol);
      } catch {
        return false;
      }
    },
    { message: `must be a valid URL starting with ${protocols.map((p) => `${p}//`).join(" or ")}` }
  );

const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess(blankToUndefined, schema.optional());

const CONTRACT_ID = z
  .string()
  .regex(/^C[A-Z2-7]{55}$/, "must be a Soroban contract ID (56 chars, starts with C)");

const flagsOverride = z.string().refine(
  (v) => {
    try {
      const parsed: unknown = JSON.parse(v);
      return (
        typeof parsed === "object" &&
        parsed !== null &&
        !Array.isArray(parsed) &&
        Object.values(parsed).every((x) => typeof x === "boolean")
      );
    } catch {
      return false;
    }
  },
  { message: 'must be a JSON object of booleans, e.g. {"realtime-oracle":true}' }
);

export const envSchema = z.object({
  NEXT_PUBLIC_API_URL: z.preprocess(
    blankToUndefined,
    urlWithProtocol(["http:", "https:"]).default("http://localhost:4001/api/v1")
  ),
  NEXT_PUBLIC_API_BASE_URL: optional(urlWithProtocol(["http:", "https:"])),
  NEXT_PUBLIC_REALTIME_URL: optional(urlWithProtocol(["ws:", "wss:"])),
  NEXT_PUBLIC_STELLAR_NETWORK: optional(
    z
      .string()
      .transform((v) => v.trim().toLowerCase())
      .pipe(z.enum(["testnet", "futurenet", "mainnet"]))
  ),
  NEXT_PUBLIC_POOL_CONTRACT_ID: optional(CONTRACT_ID),
  NEXT_PUBLIC_POLICY_CONTRACT_ID: optional(CONTRACT_ID),
  NEXT_PUBLIC_FLAGS_OVERRIDE: optional(flagsOverride),
  NEXT_PUBLIC_ENABLE_UI_GALLERY: optional(z.enum(["true", "false"])),
});

export type Env = z.infer<typeof envSchema>;

/** Parses raw env values, throwing one error that names every invalid variable and why. */
export function parseEnv(raw: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(raw);
  if (result.success) return result.data;
  const lines = result.error.issues.map((issue) => {
    const key = String(issue.path[0] ?? "env");
    const got = raw[key] === undefined ? "" : ` (got "${raw[key]}")`;
    return `  - ${key}: ${issue.message}${got}`;
  });
  throw new Error(
    `Invalid environment configuration:\n${lines.join("\n")}\nFix these in your .env file or deploy settings.`
  );
}

// Next.js only inlines literal `process.env.NEXT_PUBLIC_*` reads, so each is spelled out.
export const env = parseEnv({
  NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
  NEXT_PUBLIC_API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL,
  NEXT_PUBLIC_REALTIME_URL: process.env.NEXT_PUBLIC_REALTIME_URL,
  NEXT_PUBLIC_STELLAR_NETWORK: process.env.NEXT_PUBLIC_STELLAR_NETWORK,
  NEXT_PUBLIC_POOL_CONTRACT_ID: process.env.NEXT_PUBLIC_POOL_CONTRACT_ID,
  NEXT_PUBLIC_POLICY_CONTRACT_ID: process.env.NEXT_PUBLIC_POLICY_CONTRACT_ID,
  NEXT_PUBLIC_FLAGS_OVERRIDE: process.env.NEXT_PUBLIC_FLAGS_OVERRIDE,
  NEXT_PUBLIC_ENABLE_UI_GALLERY: process.env.NEXT_PUBLIC_ENABLE_UI_GALLERY,
});
