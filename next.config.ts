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
          { key: "Referrer-Policy", value: "no-referrer" },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
          },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
        ],
      },
      {
        // No other site may frame any page. Pages also send CSP frame-ancestors
        // 'none' (proxy.ts). /api/files/* sets its own policy: our generated
        // PDFs may be framed by our own pages (previews), uploads never.
        source: "/:path((?!api/files/).*)",
        headers: [{ key: "X-Frame-Options", value: "DENY" }],
      },
    ];
  },
};

export default nextConfig;
