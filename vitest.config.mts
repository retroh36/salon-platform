import path from "node:path";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

export default defineConfig(({ mode }) => ({
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname) },
  },
  test: {
    // Loads .env, .env.local, .env.test, .env.test.local into process.env.
    env: loadEnv(mode, process.cwd(), ""),
    projects: [
      { extends: true, test: { name: "unit", include: ["tests/unit/**/*.test.ts"] } },
      // Needs local Supabase running with the seed loaded (npx supabase db reset).
      {
        extends: true,
        test: { name: "db", include: ["tests/db/**/*.test.ts"], testTimeout: 20_000, hookTimeout: 30_000 },
      },
    ],
  },
}));
