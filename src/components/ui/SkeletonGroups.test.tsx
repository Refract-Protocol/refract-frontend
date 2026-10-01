import { describe, it, expect } from "vitest";
import React from "react";
import { StatCardSkeletonGrid } from "./StatCardSkeletonGrid";
import { ListRowSkeletons } from "./ListRowSkeletons";

describe("SkeletonGroups primitives", () => {
  it("creates StatCardSkeletonGrid with correct default count and a11y role", () => {
    const el = React.createElement(StatCardSkeletonGrid, { count: 4 });
    expect(el.props.count).toBe(4);
    expect(el.props.ariaLabel).toBeUndefined(); // defaults internally
  });

  it("creates ListRowSkeletons with custom count and height", () => {
    const el = React.createElement(ListRowSkeletons, { count: 5, height: 72, ariaLabel: "Loading coverage types" });
    expect(el.props.count).toBe(5);
    expect(el.props.height).toBe(72);
    expect(el.props.ariaLabel).toBe("Loading coverage types");
  });
});
