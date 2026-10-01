const isPreview = process.env.VERCEL_ENV === "preview";
const withBundleAnalyzer = require("@next/bundle-analyzer")({
  enabled: process.env.ANALYZE === "true",
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  env: {
    // Preview deployments are ephemeral and have no reachable backend, so force
    // the app's fixture-fallback demo mode instead of leaking a real API URL.
    NEXT_PUBLIC_API_URL: isPreview
      ? ""
      : process.env.NEXT_PUBLIC_API_URL || "",
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
    ];
  },
};

module.exports = withBundleAnalyzer(nextConfig);
