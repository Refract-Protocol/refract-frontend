import { describe, expect, it } from "vitest";
import { deriveAvailability } from "./availability";

describe("deriveAvailability", () => {
  it.each([
    [{ installed: false, allowed: true, address: "G1" }, "not-installed"],
    [{ installed: true, allowed: false, address: null }, "installed-not-allowed"],
    [{ installed: true, allowed: true, address: "" }, "locked"],
    [{ installed: true, allowed: true, address: null }, "locked"],
    [{ installed: true, allowed: true, address: "GABC" }, "ready"],
  ] as const)("%o → %s", (probe, expected) => {
    expect(deriveAvailability(probe)).toBe(expected);
  });
});
