import { defineConfig, devices } from "@playwright/test";
import { requireLocal } from "./scripts/local-only.ts";

// Supabase URL and keys, for the tests' cleanup client.
try {
  process.loadEnvFile(".env.local");
} catch {
  // Rely on the environment instead (e.g. CI).
}
// Tests never call the real Claude API: Denise runs on template wording.
delete process.env.ANTHROPIC_API_KEY;

// Never a hosted database (scripts/local-only.ts).
requireLocal("The browser tests");

// Its own server, apart from `npm run dev` on 3000 (which may have the API
// key), with its own build folder. A production build by default: the dev
// server's memory grows with every page it renders until it slows to a crawl
// and its worker runs out of heap partway through a full run, and dev runs
// every effect twice. E2E_DEV=1 uses the dev server instead (no build, so
// quicker for one file, and React's development checks run).
const PORT = 3100;
const DEV = process.env.E2E_DEV === "1";

export default defineConfig({
  testDir: "./e2e",
  // Tests share one seeded database and change it, so run them one at a time.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // Failures' evidence is also copied out of test-results/ (e2e/keep-failures.ts).
  reporter: [[process.env.CI ? "github" : "list"], ["./e2e/keep-failures.ts"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      dependencies: ["setup"],
    },
  ],
  // Reuses the test server if one is already running on its port.
  webServer: {
    command: DEV ? `next dev --port ${PORT}` : `next build && next start --port ${PORT}`,
    url: `http://localhost:${PORT}/login`,
    reuseExistingServer: true,
    timeout: 600_000,
    // Set but empty, so .env.local's key isn't loaded. MAESTRA_TEST_SERVER
    // opens the dev outbox on the production build (`outboxOpen`).
    env: {
      ANTHROPIC_API_KEY: "",
      NEXT_DIST_DIR: ".next-e2e",
      NEXT_PUBLIC_SITE_URL: `http://localhost:${PORT}`,
      MAESTRA_TEST_SERVER: "true",
    },
  },
});
