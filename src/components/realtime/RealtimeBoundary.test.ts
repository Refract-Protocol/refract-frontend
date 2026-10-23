import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { RealtimeBoundary } from "./RealtimeBoundary";
import { realtimeClient } from "@/lib/realtime/client";

function Broken() { throw new Error("bad decoded value"); }

describe("RealtimeBoundary", () => {
  it("falls back and degrades only the failed topic", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(React.createElement(React.Fragment, null,
      React.createElement(RealtimeBoundary, { topic: "oracle_update", route: "/", fallback: () => React.createElement("p", null, "REST fallback") }, React.createElement(Broken)),
      React.createElement(RealtimeBoundary, { topic: "pool_stats", route: "/provide", fallback: () => React.createElement("p", null, "Other fallback") }, React.createElement("p", null, "Pool remains live")),
    ));
    expect(screen.getByText("REST fallback")).toBeTruthy();
    expect(screen.getByText("Pool remains live")).toBeTruthy();
    expect(realtimeClient.isDegraded("oracle_update")).toBe(true);
    expect(realtimeClient.isDegraded("pool_stats")).toBe(false);
    error.mockRestore();
  });
});
import React from "react";
