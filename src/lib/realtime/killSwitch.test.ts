import { describe, expect, it, vi } from "vitest";
import { RealtimeClient } from "./client";
import {
  applyRemoteKillSwitchConfiguration,
  getKillSwitchState,
  isRealtimeDisabled,
  subscribeKillSwitch,
  tripKillSwitch,
} from "./killSwitch";

class MockSocket {
  static instances: MockSocket[] = [];
  listeners = new Map<string, Array<() => void>>();
  close = vi.fn(() => this.listeners.get("close")?.forEach((listener) => listener()));
  addEventListener(name: string, listener: () => void) {
    this.listeners.set(name, [...(this.listeners.get(name) ?? []), listener]);
  }
  constructor() {
    MockSocket.instances.push(this);
  }
}

describe("realtime kill switch", () => {
  it("defaults enabled and ignores unavailable or clear remote config", () => {
    expect(isRealtimeDisabled()).toBe(false);
    applyRemoteKillSwitchConfiguration(null);
    applyRemoteKillSwitchConfiguration({ disabled: false });
    expect(isRealtimeDisabled()).toBe(false);
  });

  it("closes an active socket immediately when remotely tripped", async () => {
    MockSocket.instances = [];
    vi.stubGlobal("WebSocket", MockSocket);
    const client = new RealtimeClient();
    const unsubscribe = client.subscribe("oracle_update", vi.fn());
    await new Promise((resolve) => setTimeout(resolve, 0));
    const socket = MockSocket.instances[0];
    expect(socket).toBeDefined();
    applyRemoteKillSwitchConfiguration({ disabled: true });
    expect(socket.close).toHaveBeenCalledOnce();
    expect(getKillSwitchState()).toEqual({ disabled: true, source: "remote" });
    unsubscribe();
    vi.unstubAllGlobals();
  });

  it("keeps a trip latched when later remote values are clear", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeKillSwitch(listener);
    tripKillSwitch("manual");
    expect(getKillSwitchState().disabled).toBe(true);
    expect(listener).toHaveBeenCalledWith({ disabled: true, source: "manual" });
    unsubscribe();
  });
});
