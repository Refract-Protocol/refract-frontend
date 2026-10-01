import type { MetadataRoute } from "next";

/**
 * Robots configuration for the application.
 *
 * The dev-only UI gallery (`/dev/ui`) is excluded from crawling so it never
 * surfaces in search results, matching the `noindex` metadata applied by the
 * gallery route itself.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/dev/", "/api/"],
    },
  };
}
