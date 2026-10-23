/** Dot-separated segments; * matches one, terminal ** matches zero or more. */
export type TopicPattern = string;
export const TOPICS = ["oracle_update", "pool_update", "claim_update"] as const;
export function compilePattern(pattern: TopicPattern): (topic: string) => boolean {
  const parts = pattern.split(".");
  if (
    pattern.length > 200 ||
    parts.some(
      (p, i) => !/^[a-zA-Z0-9_-]+$/.test(p) && p !== "*" && !(p === "**" && i === parts.length - 1)
    )
  ) {
    throw new Error(`Invalid realtime topic pattern: ${pattern}`);
  }
  return (topic) => {
    const segments = topic.split(".");
    return (
      parts.every(
        (p, i) => p === "**" || (segments[i] !== undefined && (p === "*" || p === segments[i]))
      ) &&
      (parts[parts.length - 1] === "**"
        ? segments.length >= parts.length - 1
        : segments.length === parts.length)
    );
  };
}
