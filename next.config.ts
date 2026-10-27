import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The browser tests run their own dev server with its own build folder
  // (playwright.config.ts).
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  cacheComponents: true,
  // No Next.js badge in the corner in development: it covered the sidebar
  // footer and the checkout's buttons.
  devIndicators: false,
  experimental: {
    // Salon logos are uploaded through a server action (up to 2 MB).
    serverActions: { bodySizeLimit: "3mb" },
  },
  // Denise answers "how do I…" from the help guide, read at runtime.
  outputFileTracingIncludes: { "/api/denise": ["./docs/help/*.md"] },
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
