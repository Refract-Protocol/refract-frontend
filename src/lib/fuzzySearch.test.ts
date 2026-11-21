import { describe, expect, it } from "vitest";
import { escapeRegExp, fuzzySearch } from "./fuzzySearch";

interface Item {
  id: string;
  label: string;
}

const items: Item[] = [
  { id: "1", label: "Open file" },
  { id: "2", label: "Close window" },
  { id: "3", label: "(grouped) action" },
  { id: "4", label: "[bracketed] entry" },
  { id: "5", label: "star * value" },
  { id: "6", label: "back\\slash path" },
];

const getText = (item: Item) => item.label;

describe("escapeRegExp", () => {
  it("escapes regex metacharacters", () => {
    expect(escapeRegExp("(")).toBe("\\(");
    expect(escapeRegExp("[")).toBe("\\[");
    expect(escapeRegExp("*")).toBe("\\*");
    expect(escapeRegExp("\\")).toBe("\\\\");
  });

  it("leaves plain text untouched", () => {
    expect(escapeRegExp("open file")).toBe("open file");
  });
});

describe("fuzzySearch", () => {
  it("returns the full list for empty and whitespace-only queries", () => {
    expect(fuzzySearch(items, "", getText)).toHaveLength(items.length);
    expect(fuzzySearch(items, "   ", getText)).toHaveLength(items.length);
  });

  it("does not throw on regex metacharacter queries", () => {
    expect(() => fuzzySearch(items, "(", getText)).not.toThrow();
    expect(() => fuzzySearch(items, "[", getText)).not.toThrow();
    expect(() => fuzzySearch(items, "*", getText)).not.toThrow();
    expect(() => fuzzySearch(items, "\\", getText)).not.toThrow();
  });

  it("matches literal metacharacters", () => {
    expect(fuzzySearch(items, "(", getText).map((r) => r.item.id)).toEqual(["3"]);
    expect(fuzzySearch(items, "[", getText).map((r) => r.item.id)).toEqual(["4"]);
    expect(fuzzySearch(items, "*", getText).map((r) => r.item.id)).toEqual(["5"]);
    expect(fuzzySearch(items, "\\", getText).map((r) => r.item.id)).toEqual(["6"]);
  });

  it("preserves ranking for normal queries", () => {
    const results = fuzzySearch(items, "open", getText);
    expect(results[0].item.id).toBe("1");
  });
});
