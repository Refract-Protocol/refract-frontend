import { describe, it, expect } from "vitest";
import { searchFlights, POPULAR_FLIGHTS } from "./flights";

describe("Flight Autocomplete", () => {
  it("returns popular flights when query is empty", () => {
    const results = searchFlights("");
    expect(results.length).toBeGreaterThan(0);
    expect(results.length).toBeLessThanOrEqual(POPULAR_FLIGHTS.length);
  });

  it("filters flights by flight number, airline, or airport code", () => {
    const baResults = searchFlights("BA249");
    expect(baResults.length).toBe(1);
    expect(baResults[0].flightNumber).toBe("BA249");
    expect(baResults[0].airline).toBe("British Airways");

    const sfoResults = searchFlights("SFO");
    expect(sfoResults.some((f) => f.from.includes("SFO") || f.to.includes("SFO"))).toBe(true);

    const airlineResults = searchFlights("Delta");
    expect(airlineResults.some((f) => f.airline.includes("Delta"))).toBe(true);
  });
});
