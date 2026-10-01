/**
 * Small client-side fuzzy matcher shared by search UIs. Scores a query against
 * a string: an exact substring match anywhere (not just a prefix) ranks highest,
 * earlier/word-start matches rank above later ones, and otherwise the query's
 * characters must appear in order (subsequence), with tighter matches scoring
 * higher. Returns 0 for no match.
 */
export function fuzzyScore(query: string, target: string): number {
  const q = query.trim().toLowerCase();
  const t = target.toLowerCase();
  if (!q) return 0;

  const idx = t.indexOf(q);
  if (idx !== -1) {
    const wordStart = idx === 0 || /[\s\-_./]/.test(t[idx - 1]);
    return 1000 - idx + (wordStart ? 200 : 0) + (q.length === t.length ? 500 : 0);
  }

  let ti = 0;
  let gaps = 0;
  let last = -1;
  for (const ch of q) {
    if (ch === " ") continue;
    const found = t.indexOf(ch, ti);
    if (found === -1) return 0;
    if (last !== -1) gaps += found - last - 1;
    last = found;
    ti = found + 1;
  }
  return Math.max(1, 500 - gaps * 10 - (t.length - q.length));
}

/** Filters and ranks items by the best fuzzy score across their searchable fields. */
export function fuzzySearch<T>(items: readonly T[], query: string, fields: (item: T) => string[], limit = 5): T[] {
  if (!query.trim()) return [];
  return items
    .map((item) => ({ item, score: Math.max(0, ...fields(item).map((f) => fuzzyScore(query, f))) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((r) => r.item);
}
