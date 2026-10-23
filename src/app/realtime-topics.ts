import type { TOPICS } from "@/lib/realtime/topics";
type PublicTopic = (typeof TOPICS)[number];

/** Public route wire costs, inherited by nested App Router segments. */
export const ROUTE_TOPICS = {
  "/": ["oracle_update", "pool_update", "claim_update"],
  "/cover": ["oracle_update", "pool_update"],
  "/provide": ["pool_update", "claim_update"],
} as const satisfies Record<string, readonly PublicTopic[]>;
export function topicsForRoute(pathname: string): readonly string[] {
  const route = Object.keys(ROUTE_TOPICS)
    .sort((a, b) => b.length - a.length)
    .find((route) => pathname === route || (route !== "/" && pathname.startsWith(`${route}/`)));
  return route ? ROUTE_TOPICS[route as keyof typeof ROUTE_TOPICS] : [];
}
