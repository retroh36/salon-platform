import { defineConfig, devices } from "@playwright/test";

// The simulated week (npm run test:week): its own server and build folder,
// apart from the browser tests (3100) and npm run dev (3000), since it
// starts from the default seed rather than the demo data.
try {
  process.loadEnvFile(".env.local");
} catch {
  // Rely on the environment instead (e.g. CI).
}
// Never the real Claude API: Denise runs on template wording.
delete process.env.ANTHROPIC_API_KEY;

const PORT = 3300;

export default defineConfig({
  testDir: ".",
  testMatch: /week\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["../e2e/keep-failures.ts"]],
  // A step that waits on a missing element fails in 20 seconds, not the
  // half hour the whole week has.
  use: { actionTimeout: 20_000, navigationTimeout: 60_000, baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `next dev --port ${PORT}`,
    cwd: "..",
    url: `http://localhost:${PORT}/login`,
    reuseExistingServer: true,
    timeout: 180_000,
    env: { ANTHROPIC_API_KEY: "", NEXT_DIST_DIR: ".next-week", NEXT_PUBLIC_SITE_URL: `http://localhost:${PORT}` },
  },
});
