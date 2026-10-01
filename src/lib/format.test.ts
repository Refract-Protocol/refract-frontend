import { describe, it, expect } from "vitest";
import {
  toStroops,
  fromStroops,
  formatUsd,
  formatCompactUsd,
  formatRelativeTime,
} from "./format";

describe("toStroops", () => {
  it("converts whole numbers", () => {
    expect(toStroops(1)).toBe(10_000_000n);
    expect(toStroops(0)).toBe(0n);
    expect(toStroops(100)).toBe(1_000_000_000n);
  });

  it("converts fractional amounts", () => {
    expect(toStroops(0.5)).toBe(5_000_000n);
    expect(toStroops(1.2345678)).toBe(12_345_678n);
  });

  it("rounds at the decimal boundary", () => {
    expect(toStroops(0.00000005)).toBe(1n);
    expect(toStroops(0.00000004)).toBe(0n);
    expect(toStroops(1.00000005)).toBe(10_000_001n);
  });

  it("handles negative inputs", () => {
    expect(toStroops(-1)).toBe(-10_000_000n);
    expect(toStroops(-0.5)).toBe(-5_000_000n);
  });
});

describe("fromStroops", () => {
  it("converts stroops to units", () => {
    expect(fromStroops(10_000_000n)).toBe(1);
    expect(fromStroops(0n)).toBe(0);
    expect(fromStroops(5_000_000n)).toBe(0.5);
  });

  it("handles negative stroops", () => {
    expect(fromStroops(-10_000_000n)).toBe(-1);
  });

  it("round-trips with toStroops", () => {
    for (const v of [0, 1, 0.5, 12.3456789, 100, -3.25]) {
      expect(fromStroops(toStroops(v))).toBeCloseTo(v, 7);
    }
  });
});

describe("formatUsd", () => {
  it("formats with two decimals and a dollar sign", () => {
    expect(formatUsd(1)).toBe("$1.00");
    expect(formatUsd(1234.5)).toBe("$1,234.50");
    expect(formatUsd(0)).toBe("$0.00");
  });

  it("handles negative values", () => {
    expect(formatUsd(-12.3)).toBe("-$12.30");
  });
});

describe("formatCompactUsd", () => {
  it("formats small values with two decimals", () => {
    expect(formatCompactUsd(12.34)).toBe("$12.34");
  });

  it("compacts thousands, millions and billions", () => {
    expect(formatCompactUsd(1_500)).toBe("$1.5K");
    expect(formatCompactUsd(2_000_000)).toBe("$2M");
    expect(formatCompactUsd(3_000_000_000)).toBe("$3B");
  });
});

describe("formatRelativeTime", () => {
  const now = new Date("2024-01-01T00:00:00.000Z");
  const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();
  const SECOND = 1000;
  const MINUTE = 60 * SECOND;
  const HOUR = 60 * MINUTE;
  const DAY = 24 * HOUR;
  const WEEK = 7 * DAY;
  const MONTH = 30 * DAY;
  const YEAR = 365 * DAY;

  it("returns 'just now' for very recent timestamps", () => {
    expect(formatRelativeTime(ago(0), now)).toBe("just now");
    expect(formatRelativeTime(ago(30 * SECOND), now)).toBe("just now");
  });

  it("transitions to minutes at exactly one minute", () => {
    expect(formatRelativeTime(ago(MINUTE), now)).toBe("1 minute ago");
    expect(formatRelativeTime(ago(2 * MINUTE), now)).toBe("2 minutes ago");
  });

  it("transitions to hours at exactly one hour", () => {
    expect(formatRelativeTime(ago(HOUR), now)).toBe("1 hour ago");
    expect(formatRelativeTime(ago(2 * HOUR), now)).toBe("2 hours ago");
  });

  it("transitions to days at exactly one day", () => {
    expect(formatRelativeTime(ago(DAY), now)).toBe("1 day ago");
    expect(formatRelativeTime(ago(2 * DAY), now)).toBe("2 days ago");
  });

  it("transitions to weeks at exactly one week", () => {
    expect(formatRelativeTime(ago(WEEK), now)).toBe("1 week ago");
    expect(formatRelativeTime(ago(2 * WEEK), now)).toBe("2 weeks ago");
  });

  it("transitions to months at exactly one month", () => {
    expect(formatRelativeTime(ago(MONTH), now)).toBe("1 month ago");
    expect(formatRelativeTime(ago(2 * MONTH), now)).toBe("2 months ago");
  });

  it("transitions to years at exactly one year", () => {
    expect(formatRelativeTime(ago(YEAR), now)).toBe("1 year ago");
    expect(formatRelativeTime(ago(2 * YEAR), now)).toBe("2 years ago");
  });
});
