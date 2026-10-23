import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AttentionCueService } from "../attentionCue";

const osc = () => ({ frequency: {}, connect: vi.fn(), start: vi.fn(), stop: vi.fn() });
let created: number;
let closed: number;
let vibrate: ReturnType<typeof vi.fn>;
let enabled: boolean;
let now: Date;
let reduced: boolean;

beforeEach(() => {
  created = 0;
  closed = 0;
  enabled = true;
  reduced = false;
  now = new Date(2026, 0, 1, 12, 0, 0);
  vibrate = vi.fn();
  vi.stubGlobal("AudioContext", function () {
    created += 1;
    return {
      state: "running",
      currentTime: 0,
      destination: {},
      resume: vi.fn(),
      close: () => {
        closed += 1;
      },
      createOscillator: osc,
      createGain: () => ({ gain: {}, connect: vi.fn() }),
    };
  });
  vi.stubGlobal("navigator", { vibrate });
  vi.stubGlobal("window", { matchMedia: () => ({ matches: reduced }) });
});
afterEach(() => vi.unstubAllGlobals());

const make = () => new AttentionCueService({ enabled: () => enabled, now: () => now });

describe("AttentionCueService", () => {
  it("does nothing before user unlock", () => {
    expect(make().cue("critical")).toBe(false);
    expect(created).toBe(0);
  });
  it("cues for critical after unlock and vibrates", () => {
    const s = make();
    s.unlock();
    expect(s.cue("critical")).toBe(true);
    expect(vibrate).toHaveBeenCalled();
  });
  it("is silent when the preference is off", () => {
    const s = make();
    s.unlock();
    enabled = false;
    expect(s.cue("critical")).toBe(false);
  });
  it("ignores non-critical severities and replayed events", () => {
    const s = make();
    s.unlock();
    expect(s.cue("warning")).toBe(false);
    expect(s.cue("critical", { replayed: true })).toBe(false);
  });
  it("coalesces bursts", () => {
    const s = make();
    s.unlock();
    expect(s.cue("critical")).toBe(true);
    expect(s.cue("critical")).toBe(false);
    now = new Date(now.getTime() + 1500);
    expect(s.cue("critical")).toBe(true);
  });
  it("is silent during quiet hours and reduced motion", () => {
    const s = make();
    s.unlock();
    now = new Date(2026, 0, 1, 23, 0, 0);
    expect(s.cue("critical")).toBe(false);
    now = new Date(2026, 0, 1, 12, 0, 0);
    reduced = true;
    expect(s.cue("critical")).toBe(false);
  });
  it("releases the AudioContext on dispose", () => {
    const s = make();
    s.unlock();
    s.dispose();
    expect(closed).toBe(1);
    expect(s.cue("critical")).toBe(false);
  });
});
