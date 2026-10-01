import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { LiveCountdown } from "./LiveCountdown";
import { RelativeDate } from "./RelativeDate";
import { formatDuration, formatRelativeFromNow } from "@/lib/format";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
});
afterEach(() => vi.useRealTimers());

describe("LiveCountdown", () => {
  it("renders remaining time, ticks, and is aria-live=off by default with full date available", () => {
    const target = Date.now() + 2 * 86_400_000 + 3 * 3_600_000;
    const { container } = render(<LiveCountdown target={target} />);
    const el = container.querySelector("time")!;
    expect(el).toHaveAttribute("aria-live", "off");
    expect(el).toHaveAttribute("title");
    expect(el.querySelector(".sr-only")).toBeInTheDocument();
    expect(el.textContent).toContain("2 days, 3 hours remaining");
    act(() => vi.advanceTimersByTime(60 * 60_000));
    expect(el.textContent).toContain("2 days, 2 hours remaining");
  });

  it("shows the expired label for a past target", () => {
    render(<LiveCountdown target={Date.now() - 1} expiredLabel="Unlocked" />);
    expect(screen.getByText(/Unlocked/)).toBeInTheDocument();
  });

  it("can opt in to polite announcements", () => {
    const { container } = render(<LiveCountdown target={Date.now() + 60_000} announce />);
    expect(container.querySelector("time")).toHaveAttribute("aria-live", "polite");
  });
});

describe("RelativeDate / duration helpers", () => {
  it("renders date plus relative description for future and past", () => {
    const { rerender, container } = render(<RelativeDate target={Date.now() + 3 * 86_400_000} />);
    expect(container.textContent).toBe("Jan 4, 2026 (in 3 days)");
    rerender(<RelativeDate target={Date.now() - 2 * 86_400_000} />);
    expect(container.textContent).toBe("Dec 30, 2025 (2 days ago)");
    rerender(<RelativeDate target={Date.now() + 86_400_000} hideRelative />);
    expect(container.textContent).toBe("Jan 2, 2026");
  });

  it("formats durations", () => {
    expect(formatDuration(0)).toBe("");
    expect(formatDuration(30_000)).toBe("less than a minute");
    expect(formatDuration(5 * 60_000)).toBe("5 minutes");
    expect(formatDuration(61 * 60_000)).toBe("1 hour, 1 minute");
    expect(formatDuration(86_400_000)).toBe("1 day");
    expect(formatRelativeFromNow(Date.now() + 30_000)).toBe("in less than a minute");
  });
});
