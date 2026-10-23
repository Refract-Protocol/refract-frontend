import { describe, it, expect } from "vitest";
import { classifySample, nextHealth } from "./networkHealth";

describe("networkHealth", () => {
  it("classifies samples per network threshold", () => {
    expect(classifySample("mainnet", { ledgerAgeSec: 5, rpcOk: true })).toBe("healthy");
    expect(classifySample("mainnet", { ledgerAgeSec: 45, rpcOk: true })).toBe("degraded");
    expect(classifySample("futurenet", { ledgerAgeSec: 45, rpcOk: true })).toBe("healthy");
    expect(classifySample("testnet", { ledgerAgeSec: undefined, rpcOk: true })).toBe("degraded");
    expect(classifySample("testnet", { ledgerAgeSec: undefined, rpcOk: false })).toBe(
      "unavailable"
    );
  });

  it("does not flap on a single bad sample but recovers immediately", () => {
    let s = nextHealth("healthy", "unavailable", 0);
    expect(s.health).toBe("healthy");
    s = nextHealth(s.health, "unavailable", s.streak);
    expect(s.health).toBe("unavailable");
    expect(nextHealth(s.health, "healthy", s.streak).health).toBe("healthy");
  });
});
