import { describe, expect, it, vi } from "vitest";
import { bindRealtimeLifecycle } from "./lifecycle";

describe("realtime page lifecycle", () => {
  it("suspends on pagehide and reconnects on pageshow", () => {
    const target = new EventTarget() as Window;
    Object.defineProperty(target, "document", { value: new EventTarget() });
    const client = { suspend: vi.fn(), resume: vi.fn() };
    const unbind = bindRealtimeLifecycle(client, target);
    target.dispatchEvent(new Event("pagehide"));
    target.dispatchEvent(new Event("pageshow"));
    expect(client.suspend).toHaveBeenCalledOnce();
    expect(client.resume).toHaveBeenCalledOnce();
    unbind();
  });

  it("does not double-suspend when freeze follows pagehide", () => {
    const target = new EventTarget() as Window;
    Object.defineProperty(target, "document", { value: new EventTarget() });
    const client = { suspend: vi.fn(), resume: vi.fn() };
    bindRealtimeLifecycle(client, target);
    target.dispatchEvent(new Event("pagehide"));
    target.dispatchEvent(new Event("freeze"));
    expect(client.suspend).toHaveBeenCalledOnce();
  });

  it("pauses while hidden and resumes when visible", () => {
    const documentTarget = new EventTarget() as Document;
    let visibilityState: DocumentVisibilityState = "visible";
    Object.defineProperty(documentTarget, "visibilityState", { get: () => visibilityState });
    const target = new EventTarget() as Window;
    Object.defineProperty(target, "document", { value: documentTarget });
    const client = { suspend: vi.fn(), resume: vi.fn() };
    bindRealtimeLifecycle(client, target);
    visibilityState = "hidden";
    documentTarget.dispatchEvent(new Event("visibilitychange"));
    visibilityState = "visible";
    documentTarget.dispatchEvent(new Event("visibilitychange"));
    expect(client.suspend).toHaveBeenCalledOnce();
    expect(client.resume).toHaveBeenCalledOnce();
  });
});
