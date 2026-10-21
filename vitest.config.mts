import path from "node:path";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

export default defineConfig(({ mode }) => ({
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname) },
  },
  test: {
    // Loads .env, .env.local, .env.test, .env.test.local into process.env:
    // only the Supabase settings tests need. Other secrets in .env.local
    // (e.g. Phorest credentials) stay out of the test process.
    env: loadEnv(mode, process.cwd(), ["NEXT_PUBLIC_SUPABASE_", "SUPABASE_"]),
    projects: [
      { extends: true, test: { name: "unit", include: ["tests/unit/**/*.test.ts"] } },
      // Needs local Supabase running with the seed loaded (npx supabase db reset).
      // Files share that database and some count rows in it, so they run one
      // at a time.
      {
        extends: true,
        test: { name: "db", include: ["tests/db/**/*.test.ts"], testTimeout: 20_000, hookTimeout: 30_000, fileParallelism: false },
      },
    ],
  },
}));
