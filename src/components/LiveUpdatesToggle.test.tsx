// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LiveUpdatesToggle } from "./LiveUpdatesToggle";
import { usePreferencesStore } from "@/lib/store/preferencesStore";
import { realtimeClient } from "@/lib/realtime/client";

// Spy on realtimeClient.setEnabled to verify connect/disconnect is called exactly once per toggle.
vi.mock("@/lib/realtime/client", () => {
  const setEnabled = vi.fn();
  const health = { get: () => "healthy" as const, subscribe: () => () => {} };
  const getCircuitState = vi.fn(() => "closed" as const);
  const onCircuitStateChange = vi.fn(() => () => {});
  return {
    realtimeClient: { setEnabled, health, getCircuitState, onCircuitStateChange, isCircuitOpen: () => false },
  };
});

// Mock useRealtimePreference so we control device signals independently.
vi.mock("@/hooks/useRealtimePreference", () => ({
  useRealtimePreference: vi.fn(() => ({ use: true, reason: null })),
}));

beforeEach(() => {
  usePreferencesStore.setState({ liveUpdates: "on" });
  vi.clearAllMocks();
});

afterEach(() => {
  usePreferencesStore.setState({ liveUpdates: "on" });
});

describe("LiveUpdatesToggle", () => {
  it("renders with 'on' state by default", () => {
    render(<LiveUpdatesToggle />);
    const toggle = screen.getByRole("switch", { name: /live updates/i });
    expect(toggle).toHaveAttribute("aria-checked", "true");
  });

  it("flips to off when clicked", async () => {
    render(<LiveUpdatesToggle />);
    const toggle = screen.getByRole("switch");
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-checked", "false");
  });

  it("flips back to on when clicked a second time", async () => {
    render(<LiveUpdatesToggle />);
    const toggle = screen.getByRole("switch");
    await userEvent.click(toggle);
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-checked", "true");
  });

  it("persists 'off' preference in the store", async () => {
    render(<LiveUpdatesToggle />);
    await userEvent.click(screen.getByRole("switch"));
    expect(usePreferencesStore.getState().liveUpdates).toBe("off");
  });

  it("shows 'REST only (preference)' in diagnostics when off", async () => {
    const { useRealtimePreference } = await import("@/hooks/useRealtimePreference");
    vi.mocked(useRealtimePreference).mockReturnValue({ use: false, reason: "preference" });

    render(<LiveUpdatesToggle />);
    expect(screen.getByTestId("realtime-effective-mode")).toHaveTextContent(
      "REST only (preference)"
    );
  });

  it("shows auto-downgrade banner when save-data forces off while preference is on", async () => {
    const { useRealtimePreference } = await import("@/hooks/useRealtimePreference");
    vi.mocked(useRealtimePreference).mockReturnValue({ use: false, reason: "save-data" });
    usePreferencesStore.setState({ liveUpdates: "on" });

    render(<LiveUpdatesToggle />);
    expect(screen.getByRole("status")).toHaveTextContent(/data-saving/i);
  });

  it("shows battery banner when battery saver forces off", async () => {
    const { useRealtimePreference } = await import("@/hooks/useRealtimePreference");
    vi.mocked(useRealtimePreference).mockReturnValue({ use: false, reason: "battery" });
    usePreferencesStore.setState({ liveUpdates: "on" });

    render(<LiveUpdatesToggle />);
    expect(screen.getByRole("status")).toHaveTextContent(/battery/i);
  });

  it("shows 'realtime' in diagnostics when use is true", () => {
    render(<LiveUpdatesToggle />);
    expect(screen.getByTestId("realtime-effective-mode")).toHaveTextContent("realtime");
  });
});

describe("RealtimeModeGuard wires toggle to client.setEnabled", () => {
  it("calls setEnabled(false) when preference flips to off", async () => {
    const { RealtimeModeGuard } = await import("@/lib/realtime/RealtimeModeGuard");
    // Reset mock to track fresh calls
    vi.mocked(realtimeClient.setEnabled).mockClear();

    render(
      <RealtimeModeGuard>
        <LiveUpdatesToggle />
      </RealtimeModeGuard>
    );

    // Initial mount: setEnabled(true) since preference is 'on'
    expect(realtimeClient.setEnabled).toHaveBeenCalledWith(true);
    vi.mocked(realtimeClient.setEnabled).mockClear();

    // Flip preference to off
    await userEvent.click(screen.getByRole("switch"));

    // Exactly one call with false
    expect(realtimeClient.setEnabled).toHaveBeenCalledExactlyOnceWith(false);
  });

  it("calls setEnabled(true) when preference flips back to on", async () => {
    usePreferencesStore.setState({ liveUpdates: "off" });
    const { useRealtimePreference } = await import("@/hooks/useRealtimePreference");
    vi.mocked(useRealtimePreference).mockReturnValue({ use: false, reason: "preference" });

    const { RealtimeModeGuard } = await import("@/lib/realtime/RealtimeModeGuard");
    vi.mocked(realtimeClient.setEnabled).mockClear();

    render(
      <RealtimeModeGuard>
        <LiveUpdatesToggle />
      </RealtimeModeGuard>
    );

    // Now mock returns true after the click
    vi.mocked(useRealtimePreference).mockReturnValue({ use: true, reason: null });
    await userEvent.click(screen.getByRole("switch"));

    expect(realtimeClient.setEnabled).toHaveBeenCalledWith(true);
  });
});
