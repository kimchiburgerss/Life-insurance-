import type { NextConfig } from "next";

// Cache Components / partial prefetching are deliberately OFF.
// Every screen in this app is behind operator auth and shows PII that must be
// fresh and must never be cached on a shared server cache, so the
// request-time (dynamic) rendering model is the safer default here.
const nextConfig: NextConfig = {
  cacheComponents: false,
  output: "standalone",
  poweredByHeader: false,
  serverExternalPackages: ["pg", "pg-boss"],
  // Versioned AI prompts (/prompts) and outreach templates (/templates) are read at runtime; ship them with the standalone build.
  outputFileTracingIncludes: { "/**": ["./prompts/**/*", "./templates/**/*"] },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "no-referrer" },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
