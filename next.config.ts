import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The browser tests run their own dev server with its own build folder
  // (playwright.config.ts).
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  cacheComponents: true,
  experimental: {
    // Salon logos are uploaded through a server action (up to 2 MB).
    serverActions: { bodySizeLimit: "3mb" },
  },
  partialPrefetching: true,
  // The app starts at the dashboard (the proxy sends signed-out users on to
  // /login). Temporary, so "/" can become a real page later.
  async redirects() {
    return [{ source: "/", destination: "/dashboard", permanent: false }];
  },
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
