import { describe, it, expect } from "vitest";
import {
  shouldUseRealtime,
  isBatteryLow,
  BATTERY_LOW_THRESHOLD,
  type BatteryManager,
} from "./realtimeUserPreference";

// ---------------------------------------------------------------------------
// shouldUseRealtime — selector matrix
// ---------------------------------------------------------------------------

describe("shouldUseRealtime", () => {
  it("returns use:true when all signals are permissive", () => {
    expect(
      shouldUseRealtime({ liveUpdates: "on", saveData: false, batteryLow: false })
    ).toEqual({ use: true, reason: null });
  });

  it("returns use:false with reason 'preference' when liveUpdates is off", () => {
    expect(
      shouldUseRealtime({ liveUpdates: "off", saveData: false, batteryLow: false })
    ).toEqual({ use: false, reason: "preference" });
  });

  it("returns use:false with reason 'preference' even when other signals are ok", () => {
    expect(
      shouldUseRealtime({ liveUpdates: "off", saveData: true, batteryLow: true })
    ).toEqual({ use: false, reason: "preference" });
  });

  it("returns use:false with reason 'save-data' when saveData is true", () => {
    expect(
      shouldUseRealtime({ liveUpdates: "on", saveData: true, batteryLow: false })
    ).toEqual({ use: false, reason: "save-data" });
  });

  it("returns use:false with reason 'battery' when batteryLow is true", () => {
    expect(
      shouldUseRealtime({ liveUpdates: "on", saveData: false, batteryLow: true })
    ).toEqual({ use: false, reason: "battery" });
  });

  it("preference wins over save-data (checked first)", () => {
    expect(
      shouldUseRealtime({ liveUpdates: "off", saveData: true, batteryLow: false })
    ).toEqual({ use: false, reason: "preference" });
  });

  it("save-data wins over battery (checked second)", () => {
    expect(
      shouldUseRealtime({ liveUpdates: "on", saveData: true, batteryLow: true })
    ).toEqual({ use: false, reason: "save-data" });
  });

  it("battery wins when only battery is set", () => {
    expect(
      shouldUseRealtime({ liveUpdates: "on", saveData: false, batteryLow: true })
    ).toEqual({ use: false, reason: "battery" });
  });

  // All combinations matrix
  const cases: Array<[string, Parameters<typeof shouldUseRealtime>[0], boolean, string | null]> = [
    ["on/false/false", { liveUpdates: "on", saveData: false, batteryLow: false }, true, null],
    ["on/true/false",  { liveUpdates: "on", saveData: true,  batteryLow: false }, false, "save-data"],
    ["on/false/true",  { liveUpdates: "on", saveData: false, batteryLow: true  }, false, "battery"],
    ["on/true/true",   { liveUpdates: "on", saveData: true,  batteryLow: true  }, false, "save-data"],
    ["off/false/false",{ liveUpdates: "off",saveData: false, batteryLow: false }, false, "preference"],
    ["off/true/false", { liveUpdates: "off",saveData: true,  batteryLow: false }, false, "preference"],
    ["off/false/true", { liveUpdates: "off",saveData: false, batteryLow: true  }, false, "preference"],
    ["off/true/true",  { liveUpdates: "off",saveData: true,  batteryLow: true  }, false, "preference"],
  ];

  it.each(cases)("matrix[%s] → use=%s reason=%s", (_label, inputs, expectedUse, expectedReason) => {
    const result = shouldUseRealtime(inputs);
    expect(result.use).toBe(expectedUse);
    expect(result.reason).toBe(expectedReason);
  });
});

// ---------------------------------------------------------------------------
// isBatteryLow
// ---------------------------------------------------------------------------

describe("isBatteryLow", () => {
  const makeBattery = (level: number, charging: boolean): BatteryManager => ({
    level,
    charging,
    addEventListener: () => {},
    removeEventListener: () => {},
  });

  it("returns false when battery is null", () => {
    expect(isBatteryLow(null)).toBe(false);
  });

  it("returns false when charging regardless of level", () => {
    expect(isBatteryLow(makeBattery(0.05, true))).toBe(false);
  });

  it("returns false when level is above threshold and discharging", () => {
    expect(isBatteryLow(makeBattery(BATTERY_LOW_THRESHOLD + 0.01, false))).toBe(false);
  });

  it("returns true when level is at threshold and discharging", () => {
    expect(isBatteryLow(makeBattery(BATTERY_LOW_THRESHOLD, false))).toBe(true);
  });

  it("returns true when level is below threshold and discharging", () => {
    expect(isBatteryLow(makeBattery(0.05, false))).toBe(true);
  });

  it("returns false when level is 0 but charging", () => {
    expect(isBatteryLow(makeBattery(0, true))).toBe(false);
  });
});
