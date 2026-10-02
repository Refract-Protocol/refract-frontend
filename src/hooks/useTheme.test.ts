import { describe, it, expect, beforeEach, vi } from "vitest";
import { getInitialTheme, THEME_STORAGE_KEY } from "./useTheme";

describe("getInitialTheme", () => {
  let mockStorage: Record<string, string> = {};

  beforeEach(() => {
    mockStorage = {};
    const localStorageMock = {
      getItem: vi.fn((key: string) => mockStorage[key] || null),
      setItem: vi.fn((key: string, value: string) => {
        mockStorage[key] = value;
      }),
      clear: vi.fn(() => {
        mockStorage = {};
      }),
      removeItem: vi.fn((key: string) => {
        delete mockStorage[key];
      }),
    };

    vi.stubGlobal("localStorage", localStorageMock);
    vi.stubGlobal("window", {
      matchMedia: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
      })),
    });
  });

  it("returns saved theme from localStorage when valid", () => {
    mockStorage[THEME_STORAGE_KEY] = "light";
    expect(getInitialTheme()).toBe("light");

    mockStorage[THEME_STORAGE_KEY] = "dark";
    expect(getInitialTheme()).toBe("dark");
  });

  it("respects prefers-color-scheme light when no saved theme exists", () => {
    vi.stubGlobal("window", {
      matchMedia: vi.fn().mockImplementation((query: string) => ({
        matches: query === "(prefers-color-scheme: light)",
        media: query,
      })),
    });

    expect(getInitialTheme()).toBe("light");
  });

  it("defaults to dark when prefers-color-scheme is dark or unmatched", () => {
    expect(getInitialTheme()).toBe("dark");
  });
});

