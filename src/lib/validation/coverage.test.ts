import { describe, it, expect } from "vitest";
import { validateBuyCoverage, createBuyCoverageSchema } from "./coverage";

describe("Coverage Validation Schema", () => {
  const bounds = {
    effectiveMin: 100,
    effectiveMax: 50000,
    isFlightDelay: false,
  };

  it("validates boundary conditions accurately", () => {
    // Exactly at min
    expect(validateBuyCoverage({ coverageAmount: 100 }, bounds).isValid).toBe(true);

    // Exactly at max
    expect(validateBuyCoverage({ coverageAmount: 50000 }, bounds).isValid).toBe(true);

    // Valid intermediate
    expect(validateBuyCoverage({ coverageAmount: "5000" }, bounds).isValid).toBe(true);

    // One below min
    const belowMin = validateBuyCoverage({ coverageAmount: 99 }, bounds);
    expect(belowMin.isValid).toBe(false);
    expect(belowMin.errors.coverageAmount).toBe("Enter an amount between $100 and $50,000");

    // Above max
    const aboveMax = validateBuyCoverage({ coverageAmount: 50001 }, bounds);
    expect(aboveMax.isValid).toBe(false);
    expect(aboveMax.errors.coverageAmount).toBe("Enter an amount between $100 and $50,000");
  });

  it("validates flight number requirement for flight delay coverage", () => {
    const flightBounds = { ...bounds, isFlightDelay: true };

    // Missing flight number
    const missingFlight = validateBuyCoverage({ coverageAmount: 1000, flightNumber: "" }, flightBounds);
    expect(missingFlight.isValid).toBe(false);
    expect(missingFlight.errors.flightNumber).toBe("Enter the flight number this policy should monitor");

    // Whitespace-only flight number
    const whitespaceFlight = validateBuyCoverage({ coverageAmount: 1000, flightNumber: "   " }, flightBounds);
    expect(whitespaceFlight.isValid).toBe(false);
    expect(whitespaceFlight.errors.flightNumber).toBe("Enter the flight number this policy should monitor");

    // Valid flight number
    const validFlight = validateBuyCoverage({ coverageAmount: 1000, flightNumber: "BA249" }, flightBounds);
    expect(validFlight.isValid).toBe(true);
    expect(validFlight.errors.flightNumber).toBeUndefined();
  });
});
