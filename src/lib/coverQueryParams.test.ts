import { describe, it, expect } from "vitest";
import {
  parseCoverQueryParams,
  serializeCoverQueryParams,
} from "./coverQueryParams";

describe("coverQueryParams", () => {
  it("parses valid query parameters correctly", () => {
    const params = new URLSearchParams("type=2&amount=7500&duration=45&flight=BA249");
    const parsed = parseCoverQueryParams(params, { validTypeIds: [0, 1, 2, 3, 4] });

    expect(parsed.type).toBe(2);
    expect(parsed.amount).toBe("7500");
    expect(parsed.duration).toBe(45);
    expect(parsed.flight).toBe("BA249");
  });

  it("handles missing or empty query parameters gracefully", () => {
    const params = new URLSearchParams("");
    const parsed = parseCoverQueryParams(params);

    expect(parsed.type).toBeUndefined();
    expect(parsed.amount).toBeUndefined();
    expect(parsed.duration).toBeUndefined();
    expect(parsed.flight).toBeUndefined();
  });

  it("clamps out-of-range amount and duration values", () => {
    const params = new URLSearchParams("type=1&amount=50&duration=500");
    const parsed = parseCoverQueryParams(params, {
      minAmount: 100,
      maxAmount: 50000,
      minDuration: 1,
      maxDuration: 365,
    });

    expect(parsed.amount).toBe("100"); // Clamped to min 100
    expect(parsed.duration).toBe(365); // Clamped to max 365
  });

  it("filters out invalid type ids when validTypeIds is provided", () => {
    const params = new URLSearchParams("type=999&amount=5000");
    const parsed = parseCoverQueryParams(params, { validTypeIds: [0, 1, 2, 3, 4] });

    expect(parsed.type).toBeUndefined();
    expect(parsed.amount).toBe("5000");
  });

  it("serializes query params to a query string and round-trips cleanly", () => {
    const input = {
      type: 4,
      amount: "10000",
      duration: 60,
      flight: "AA100",
    };

    const qs = serializeCoverQueryParams(input);
    expect(qs).toBe("type=4&amount=10000&duration=60&flight=AA100");

    const parsedBack = parseCoverQueryParams(new URLSearchParams(qs));
    expect(parsedBack.type).toBe(input.type);
    expect(parsedBack.amount).toBe(input.amount);
    expect(parsedBack.duration).toBe(input.duration);
    expect(parsedBack.flight).toBe(input.flight);
  });
});
