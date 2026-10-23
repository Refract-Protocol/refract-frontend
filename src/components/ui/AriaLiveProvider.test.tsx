import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { AriaLiveProvider, useAriaLive } from "@/components/ui/AriaLiveProvider";
import React from "react";

/** Test harness that exposes announce via buttons. */
function TestConsumer() {
  const { announce } = useAriaLive();
  return (
    <div>
      <button type="button" onClick={() => announce("first")}>
        announce-first
      </button>
      <button type="button" onClick={() => announce("second")}>
        announce-second
      </button>
      <button
        type="button"
        onClick={() => {
          announce("Oracle reading updated");
          announce("Pool statistics updated");
          announce("Claim settled");
        }}
      >
        announce-batch
      </button>
      <button type="button" onClick={() => announce("")}>
        announce-empty
      </button>
    </div>
  );
}

function renderProvider() {
  return render(
    <AriaLiveProvider>
      <TestConsumer />
    </AriaLiveProvider>,
  );
}

describe("AriaLiveProvider", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders a polite aria-live region", () => {
    renderProvider();
    const region = document.querySelector('[aria-live="polite"]');
    expect(region).not.toBeNull();
    expect(region?.getAttribute("aria-atomic")).toBe("true");
    expect(region?.className).toContain("sr-only");
  });

  it("flushes a single announcement when the timer fires", () => {
    renderProvider();
    const region = document.querySelector('[aria-live="polite"]')!;
    expect(region.textContent).toBe("");

    act(() => {
      screen.getByText("announce-first").click();
      vi.advanceTimersByTime(0);
    });

    expect(region.textContent).toContain("first");
  });

  it("coalesces multiple messages in the same tick into one announcement", () => {
    renderProvider();
    const region = document.querySelector('[aria-live="polite"]')!;

    act(() => {
      screen.getByText("announce-batch").click();
      vi.advanceTimersByTime(0);
    });

    // All three messages should be joined into one announcement.
    expect(region.textContent).toContain("Oracle reading updated");
    expect(region.textContent).toContain("Pool statistics updated");
    expect(region.textContent).toContain("Claim settled");
  });

  it("does not flush a second announcement within the 2s throttle window", () => {
    renderProvider();
    const region = document.querySelector('[aria-live="polite"]')!;

    // First announcement — flushed via 0ms timer.
    act(() => {
      screen.getByText("announce-first").click();
      vi.advanceTimersByTime(0);
    });
    expect(region.textContent).toContain("first");

    // Advance only 500ms (within the 2s window).
    act(() => vi.advanceTimersByTime(500));

    // Second call — should queue but not flush yet.
    act(() => {
      screen.getByText("announce-second").click();
      vi.advanceTimersByTime(0);
    });

    expect(region.textContent).not.toContain("second");

    // Advance past the remaining throttle window — the queued message
    // should now flush.
    act(() => vi.advanceTimersByTime(2000));
    expect(region.textContent).toContain("second");
  });

  it("ignores empty messages", () => {
    renderProvider();
    const region = document.querySelector('[aria-live="polite"]')!;
    act(() => {
      screen.getByText("announce-empty").click();
      vi.advanceTimersByTime(3000);
    });
    expect(region.textContent).toBe("");
  });

  it("useAriaLive returns a no-op announce when used outside provider", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    function Orphan() {
      const { announce } = useAriaLive();
      return (
        <button type="button" onClick={() => announce("hello")}>
          orphan
        </button>
      );
    }
    render(<Orphan />);
    expect(() => screen.getByText("orphan").click()).not.toThrow();
    spy.mockRestore();
  });
});
