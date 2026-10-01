import { describe, it, expect } from "vitest";
import {
  calculateMatchScore,
  searchCommands,
  wrapIndex,
  STATIC_COMMANDS,
  type CommandItem,
} from "./commands";

describe("calculateMatchScore", () => {
  it("scores exact matches highest", () => {
    const exact = calculateMatchScore("Home", "Home");
    const prefix = calculateMatchScore("Ho", "Home");
    const substring = calculateMatchScore("om", "Home");

    expect(exact).toBeGreaterThan(prefix);
    expect(prefix).toBeGreaterThan(substring);
  });

  it("scores word boundary matches well", () => {
    const score = calculateMatchScore("depeg", "Stablecoin Depeg");
    expect(score).toBeGreaterThan(0);
  });

  it("returns 0 when no characters match", () => {
    const score = calculateMatchScore("xyz", "Stablecoin Depeg");
    expect(score).toBe(0);
  });
});

describe("searchCommands", () => {
  const testCommands: CommandItem[] = [
    { id: "1", label: "Dashboard", category: "Navigation", keywords: ["stats", "portfolio"] },
    { id: "2", label: "Get Coverage", category: "Navigation", keywords: ["insurance", "buy"] },
    { id: "3", label: "Buy Flight Delay coverage", category: "Coverage", keywords: ["airline"] },
  ];

  it("returns all commands when query is empty", () => {
    const res = searchCommands("", testCommands);
    expect(res.length).toBe(3);
  });

  it("matches by label", () => {
    const res = searchCommands("dash", testCommands);
    expect(res[0].id).toBe("1");
  });

  it("matches by keyword", () => {
    const res = searchCommands("insurance", testCommands);
    expect(res[0].id).toBe("2");
  });

  it("orders results by relevance", () => {
    const res = searchCommands("flight", STATIC_COMMANDS);
    expect(res.length).toBeGreaterThan(0);
    expect(res[0].label).toContain("Flight");
  });

  it("returns empty array when nothing matches", () => {
    const res = searchCommands("nonexistentcommandquery123", testCommands);
    expect(res).toEqual([]);
  });
});

describe("wrapIndex", () => {
  it("wraps forward past the end", () => {
    expect(wrapIndex(2, 1, 3)).toBe(0);
    expect(wrapIndex(0, 1, 3)).toBe(1);
  });

  it("wraps backward past the start", () => {
    expect(wrapIndex(0, -1, 3)).toBe(2);
    expect(wrapIndex(2, -1, 3)).toBe(1);
  });

  it("returns 0 for empty list", () => {
    expect(wrapIndex(0, 1, 0)).toBe(0);
  });
});
