export interface FuzzyMatch<T> {
  item: T;
  score: number;
  matches: number[];
}

/**
 * Escape regex metacharacters so a raw user query can be safely embedded in a
 * RegExp pattern. Without this, queries like `(` or `[` throw a SyntaxError.
 */
export function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildPattern(query: string): RegExp {
  const escaped = escapeRegExp(query);
  // Match each character of the query in order, allowing gaps between them.
  const chars = escaped.split("").join(".*?");
  return new RegExp(chars, "i");
}

export function fuzzySearch<T>(
  items: T[],
  query: string,
  getText: (item: T) => string,
): FuzzyMatch<T>[] {
  const trimmed = query.trim();

  if (trimmed.length === 0) {
    return items.map((item) => ({ item, score: 0, matches: [] }));
  }

  const pattern = buildPattern(trimmed);
  const results: FuzzyMatch<T>[] = [];

  for (const item of items) {
    const text = getText(item);
    const match = pattern.exec(text);
    if (!match) continue;

    const matches: number[] = [];
    for (let i = 0; i < match[0].length; i++) {
      matches.push(match.index + i);
    }

    // Shorter matches and earlier positions rank higher.
    const score = match[0].length + match.index;
    results.push({ item, score, matches });
  }

  results.sort((a, b) => a.score - b.score);
  return results;
}
