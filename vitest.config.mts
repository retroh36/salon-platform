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
      // Needs local Supabase running with the demo data loaded (npm run seed:demo).
      // Files share that database and some count rows in it, so they run one
      // at a time.
      {
        extends: true,
        test: { name: "db", include: ["tests/db/**/*.test.ts"], setupFiles: ["tests/db/demo-check.ts"], testTimeout: 20_000, hookTimeout: 30_000, fileParallelism: false },
      },
      // npm run eval:denise: real questions to the real Claude API against
      // the demo data (costs tokens). The only project given the API key.
      // EVAL_DRY=1 checks the cases and expected facts without calling it.
      {
        extends: true,
        test: {
          name: "eval",
          include: ["evals/**/*.eval.ts"],
          env: loadEnv(mode, process.cwd(), ["NEXT_PUBLIC_SUPABASE_", "SUPABASE_", "ANTHROPIC_API_KEY", "EVAL_"]),
          testTimeout: 180_000,
          hookTimeout: 60_000,
          fileParallelism: false,
        },
      },
    ],
  },
}));
