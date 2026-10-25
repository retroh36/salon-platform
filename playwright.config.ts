import { defineConfig, devices } from "@playwright/test";

// Supabase URL and keys, for the tests' cleanup client.
try {
  process.loadEnvFile(".env.local");
} catch {
  // Rely on the environment instead (e.g. CI).
}
// Tests never call the real Claude API: Denise runs on template wording.
delete process.env.ANTHROPIC_API_KEY;

// Its own server, apart from `npm run dev` on 3000 (which may have the API
// key), with its own build folder.
const PORT = 3100;

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
    command: `next dev --port ${PORT}`,
    url: `http://localhost:${PORT}/login`,
    reuseExistingServer: true,
    timeout: 180_000,
    // Set but empty, so .env.local's key isn't loaded.
    env: { ANTHROPIC_API_KEY: "", NEXT_DIST_DIR: ".next-e2e", NEXT_PUBLIC_SITE_URL: `http://localhost:${PORT}` },
  },
});
