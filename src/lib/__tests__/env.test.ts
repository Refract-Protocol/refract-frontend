import { describe, it, expect } from "vitest";
import { parseEnv } from "../env";

const CID = "C" + "A".repeat(55);

describe("parseEnv", () => {
  it("applies the local-dev API default when unset or blank", () => {
    expect(parseEnv({}).NEXT_PUBLIC_API_URL).toBe("http://localhost:4001/api/v1");
    expect(parseEnv({ NEXT_PUBLIC_API_URL: "" }).NEXT_PUBLIC_API_URL).toBe(
      "http://localhost:4001/api/v1"
    );
  });

  it("accepts a fully valid config", () => {
    const env = parseEnv({
      NEXT_PUBLIC_API_URL: "https://api.refract.test/api/v1",
      NEXT_PUBLIC_REALTIME_URL: "wss://api.refract.test/ws",
      NEXT_PUBLIC_STELLAR_NETWORK: " Mainnet ",
      NEXT_PUBLIC_POOL_CONTRACT_ID: CID,
      NEXT_PUBLIC_POLICY_CONTRACT_ID: CID,
      NEXT_PUBLIC_FLAGS_OVERRIDE: '{"realtime-oracle":true}',
      NEXT_PUBLIC_ENABLE_UI_GALLERY: "true",
    });
    expect(env.NEXT_PUBLIC_STELLAR_NETWORK).toBe("mainnet");
    expect(env.NEXT_PUBLIC_REALTIME_URL).toBe("wss://api.refract.test/ws");
  });

  it.each([
    ["NEXT_PUBLIC_API_URL", "localhost:4001", "http://"],
    ["NEXT_PUBLIC_API_URL", "ftp://x.test", "http://"],
    ["NEXT_PUBLIC_API_BASE_URL", "nope", "http://"],
    ["NEXT_PUBLIC_REALTIME_URL", "https://x.test", "ws://"],
    ["NEXT_PUBLIC_STELLAR_NETWORK", "devnet", "expected one of"],
    ["NEXT_PUBLIC_POOL_CONTRACT_ID", "abc", "contract ID"],
    ["NEXT_PUBLIC_POLICY_CONTRACT_ID", "abc", "contract ID"],
    ["NEXT_PUBLIC_FLAGS_OVERRIDE", "{bad", "JSON object of booleans"],
    ["NEXT_PUBLIC_FLAGS_OVERRIDE", '{"a":1}', "JSON object of booleans"],
    ["NEXT_PUBLIC_FLAGS_OVERRIDE", "[true]", "JSON object of booleans"],
    ["NEXT_PUBLIC_ENABLE_UI_GALLERY", "yes", "expected one of"],
  ])("rejects invalid %s=%s with an actionable message", (key, value, hint) => {
    expect(() => parseEnv({ [key]: value })).toThrow(
      new RegExp(`${key}: .*${hint.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}`, "s")
    );
  });

  it("reports every invalid variable at once", () => {
    expect(() => parseEnv({ NEXT_PUBLIC_API_URL: "x", NEXT_PUBLIC_STELLAR_NETWORK: "y" })).toThrow(
      /NEXT_PUBLIC_API_URL[\s\S]*NEXT_PUBLIC_STELLAR_NETWORK/
    );
  });
});
