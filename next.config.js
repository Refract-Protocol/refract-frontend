const isPreview = process.env.VERCEL_ENV === "preview";
const withBundleAnalyzer = require("@next/bundle-analyzer")({
  enabled: process.env.ANALYZE === "true",
});
const { endpointFromApiBase } = require("./src/lib/realtime/endpointConfig");

function realtimeConnectSources() {
  let endpoint;
  try {
    endpoint = endpointFromApiBase(
      process.env.NEXT_PUBLIC_API_URL || "http://localhost:4001/api/v1"
    );
  } catch {
    throw new Error("NEXT_PUBLIC_API_URL must be an absolute URL to build the realtime CSP");
  }
  return `'self' ${endpoint.websocketOrigin} ${endpoint.apiOrigin}`;
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  env: {
    // Preview deployments are ephemeral and have no reachable backend, so force
    // the app's fixture-fallback demo mode instead of leaking a real API URL.
    NEXT_PUBLIC_API_URL: isPreview
      ? ""
      : process.env.NEXT_PUBLIC_API_URL || "",
    NEXT_PUBLIC_SENTRY_RELEASE:
      process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA || "",
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
      {
        source: "/(.*)",
        headers: [
          {
            key: "Content-Security-Policy-Report-Only",
            value: `default-src 'self'; connect-src ${realtimeConnectSources()}`,
          },
        ],
      },
    ];
  },
};

const { withSentryConfig } = require("@sentry/nextjs");

// Source maps are uploaded only when all three credentials are present, so
// local builds, forks and CI without secrets build normally.
const canUploadSourceMaps = Boolean(
  process.env.SENTRY_AUTH_TOKEN && process.env.SENTRY_ORG && process.env.SENTRY_PROJECT,
);

module.exports = withSentryConfig(withBundleAnalyzer(nextConfig), {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  release: { name: process.env.NEXT_PUBLIC_SENTRY_RELEASE || undefined },
  silent: true,
  hideSourceMaps: true,
  widenClientFileUpload: true,
  sourcemaps: { disable: !canUploadSourceMaps },
});
