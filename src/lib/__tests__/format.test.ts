/**
 * Unit tests for src/lib/format.ts
 *
 * Coverage requirements (Issue #125):
 *  - toStroops / fromStroops across multiple decimal configurations
 *    (0, 2, 7, 18)
 *  - Full regression suite confirming every existing default-decimals
 *    (USDC, 7 decimal) call-site output is byte-identical after the
 *    optional-parameter refactor.
 *  - Edge cases: zero, negative, sub-stroop rounding, floating-point
 *    precision hazards, string vs number inputs.
 */

import { describe, it, expect } from "vitest";
import {
  USDC_DECIMALS,
  toStroops,
  fromStroops,
  formatUsd,
  formatCompactUsd,
  formatRelativeTime,
} from "../format";
import { USDC } from "../assets";

// ---------------------------------------------------------------------------
// USDC_DECIMALS constant
// ---------------------------------------------------------------------------

describe("USDC_DECIMALS", () => {
  it("is exported and equals 7", () => {
    expect(USDC_DECIMALS).toBe(7);
  });

  it("matches the decimals on the USDC AssetInfo constant", () => {
    expect(USDC_DECIMALS).toBe(USDC.decimals);
  });
});

// ---------------------------------------------------------------------------
// toStroops — default (USDC / 7 decimals)
// ---------------------------------------------------------------------------

describe("toStroops — default decimals (USDC regression suite)", () => {
  it("converts a round integer amount", () => {
    expect(toStroops(5000)).toBe("50000000000");
  });

  it("converts 1 USDC to 10_000_000 stroops", () => {
    expect(toStroops(1)).toBe("10000000");
  });

  it("converts a fractional amount with 7 significant decimals", () => {
    // 5000.25 USDC → 5000.25 × 1e7 = 50_002_500_000
    expect(toStroops(5000.25)).toBe("50002500000");
  });

  it("returns '0' for zero", () => {
    expect(toStroops(0)).toBe("0");
  });

  it("handles small sub-stroop rounding up", () => {
    // 0.00000005 rounds to 1 stroop at 7 decimals
    expect(toStroops(0.00000005)).toBe("1");
  });

  it("handles small sub-stroop rounding down to 0", () => {
    // 0.000000049 rounds to 0 at 7 decimals
    expect(toStroops(0.000000049)).toBe("0");
  });

  it("handles negative amounts", () => {
    expect(toStroops(-100)).toBe("-1000000000");
  });

  it("handles large policy amounts (cover/page.tsx: 25_000 USDC)", () => {
    // Regression: largest quick-amount button in cover/page.tsx
    expect(toStroops(25000)).toBe("250000000000");
  });

  it("produces a string (not a number or bigint)", () => {
    expect(typeof toStroops(1)).toBe("string");
  });

  // Exact byte-identical regression for all numeric literals used at call
  // sites found during audit (cover/page.tsx, provide/page.tsx).
  it.each([
    [1000,  "10000000000"],
    [5000,  "50000000000"],
    [10000, "100000000000"],
    [25000, "250000000000"],
  ])("toStroops(%d) === '%s' (call-site regression)", (input, expected) => {
    expect(toStroops(input)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// toStroops — explicit decimals parameter
// ---------------------------------------------------------------------------

describe("toStroops — explicit decimals parameter", () => {
  it("0 decimals: treats amount as an integer, no scaling", () => {
    expect(toStroops(42, 0)).toBe("42");
  });

  it("0 decimals: rounds fractional input", () => {
    expect(toStroops(42.7, 0)).toBe("43");
  });

  it("2 decimals: 1.00 → 100", () => {
    expect(toStroops(1, 2)).toBe("100");
  });

  it("2 decimals: 9.99 → 999", () => {
    expect(toStroops(9.99, 2)).toBe("999");
  });

  it("2 decimals: 0.005 rounds to 1", () => {
    expect(toStroops(0.005, 2)).toBe("1");
  });

  it("7 decimals (explicit): identical to default", () => {
    const amount = 123.4567891;
    expect(toStroops(amount, 7)).toBe(toStroops(amount));
  });

  it("18 decimals: handles large precision", () => {
    // 1 × 10^18 = "1000000000000000000"
    expect(toStroops(1, 18)).toBe("1000000000000000000");
  });

  it("18 decimals: zero stays zero", () => {
    expect(toStroops(0, 18)).toBe("0");
  });
});

// ---------------------------------------------------------------------------
// fromStroops — default (USDC / 7 decimals)
// ---------------------------------------------------------------------------

describe("fromStroops — default decimals (USDC regression suite)", () => {
  it("converts 10_000_000 stroops to 1 USDC", () => {
    expect(fromStroops("10000000")).toBe(1);
  });

  it("converts '50000000000' to 5000", () => {
    expect(fromStroops("50000000000")).toBe(5000);
  });

  it("converts 0 stroops to 0", () => {
    expect(fromStroops("0")).toBe(0);
  });

  it("accepts a numeric input as well as a string", () => {
    expect(fromStroops(10000000)).toBe(1);
    expect(fromStroops("10000000")).toBe(1);
  });

  it("returns a number (not a string)", () => {
    expect(typeof fromStroops("10000000")).toBe("number");
  });

  // Regression for every fromStroops call site found during audit.
  // dashboard/page.tsx: fromStroops(p.coverageAmount), fromStroops(p.premium),
  //                     fromStroops(c.payout)
  // provide/page.tsx:   fromStroops(position.shares)
  it.each([
    // [stroop_string, expected_human_value]
    ["50000000000",  5000],
    ["10000000000",  1000],
    ["2500000000",   250],
    ["10000000",     1],
    ["1",            0.0000001],
  ])("fromStroops('%s') === %f (call-site regression)", (input, expected) => {
    expect(fromStroops(input)).toBeCloseTo(expected, 10);
  });
});

// ---------------------------------------------------------------------------
// fromStroops — explicit decimals parameter
// ---------------------------------------------------------------------------

describe("fromStroops — explicit decimals parameter", () => {
  it("0 decimals: value unchanged", () => {
    expect(fromStroops("42", 0)).toBe(42);
  });

  it("2 decimals: 100 → 1.0", () => {
    expect(fromStroops("100", 2)).toBe(1);
  });

  it("2 decimals: 999 → 9.99", () => {
    expect(fromStroops("999", 2)).toBeCloseTo(9.99, 10);
  });

  it("7 decimals (explicit): identical to default", () => {
    const stroops = "50002500000";
    expect(fromStroops(stroops, 7)).toBe(fromStroops(stroops));
  });

  it("18 decimals: 1e18 → 1", () => {
    // Note: JavaScript Number loses precision above Number.MAX_SAFE_INTEGER;
    // this test verifies the arithmetic is structurally correct within safe range.
    expect(fromStroops("1000000000000000000", 18)).toBeCloseTo(1, 5);
  });
});

// ---------------------------------------------------------------------------
// Round-trip invariants: toStroops(fromStroops(x)) === x
// ---------------------------------------------------------------------------

describe("round-trip invariants", () => {
  const cases: [number, number][] = [
    [5000, 7],
    [1, 7],
    [0, 7],
    [42, 2],
    [9.99, 2],
    [1000, 0],
  ];

  it.each(cases)(
    "fromStroops(toStroops(%d, %d), %d) ≈ original",
    (amount, decimals) => {
      const stroops = toStroops(amount, decimals);
      const recovered = fromStroops(stroops, decimals);
      // Allow floating-point tolerance at the last digit
      expect(recovered).toBeCloseTo(amount, decimals);
    }
  );
});

// ---------------------------------------------------------------------------
// Other format helpers — unchanged behaviour regression
// ---------------------------------------------------------------------------

describe("formatUsd", () => {
  it("formats a round number as USD", () => {
    expect(formatUsd(5000)).toBe("$5,000.00");
  });

  it("formats zero", () => {
    expect(formatUsd(0)).toBe("$0.00");
  });

  it("accepts Intl options override", () => {
    // Override both min and max fraction digits to 0 to get a whole-dollar string.
    expect(
      formatUsd(1234567, { minimumFractionDigits: 0, maximumFractionDigits: 0 })
    ).toBe("$1,234,567");
  });
});

describe("formatCompactUsd", () => {
  it("formats values below 1_000 as regular currency", () => {
    expect(formatCompactUsd(500)).toBe("$500.00");
  });

  it("formats values >= 1_000 with K suffix", () => {
    expect(formatCompactUsd(2500)).toBe("$2.5K");
  });

  it("formats values >= 1_000_000 with M suffix", () => {
    expect(formatCompactUsd(3_500_000)).toBe("$3.5M");
  });
});

describe("formatRelativeTime", () => {
  const now = Date.now();

  it("returns 'just now' for recent timestamps", () => {
    expect(formatRelativeTime(now - 30_000)).toBe("just now");
  });

  it("returns minutes ago", () => {
    expect(formatRelativeTime(now - 3 * 60_000)).toBe("3 minutes ago");
  });

  it("returns singular 'minute ago'", () => {
    expect(formatRelativeTime(now - 61_000)).toBe("1 minute ago");
  });

  it("returns hours ago", () => {
    expect(formatRelativeTime(now - 2 * 3_600_000)).toBe("2 hours ago");
  });

  it("returns days ago", () => {
    expect(formatRelativeTime(now - 3 * 86_400_000)).toBe("3 days ago");
  });

  it("returns weeks ago", () => {
    expect(formatRelativeTime(now - 2 * 604_800_000)).toBe("2 weeks ago");
  });
});
