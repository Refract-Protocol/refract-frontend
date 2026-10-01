import { describe, it, expect } from "vitest";
import { HOW_IT_WORKS_STEPS } from "./HowItWorks";

describe("HowItWorks component data and structure", () => {
  it("defines exactly 3 narrative steps in sequence", () => {
    expect(HOW_IT_WORKS_STEPS).toHaveLength(3);
    expect(HOW_IT_WORKS_STEPS[0].step).toBe("01");
    expect(HOW_IT_WORKS_STEPS[1].step).toBe("02");
    expect(HOW_IT_WORKS_STEPS[2].step).toBe("03");
  });

  it("contains complete titles, descriptions, and highlights for all steps", () => {
    for (const step of HOW_IT_WORKS_STEPS) {
      expect(step.title.length).toBeGreaterThan(5);
      expect(step.desc.length).toBeGreaterThan(20);
      expect(step.highlight.length).toBeGreaterThan(10);
      expect(step.icon).toBeTruthy();
    }
  });
});
