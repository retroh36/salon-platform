import { defineConfig, devices } from "@playwright/test";

// Supabase URL and keys, for the tests' cleanup client.
try {
  process.loadEnvFile(".env.local");
} catch {
  // Rely on the environment instead (e.g. CI).
}

const PORT = 3000;

export default defineConfig({
  testDir: "./e2e",
  // Tests share one seeded database and change it, so run them one at a time.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      dependencies: ["setup"],
    },
  ],
  // Uses a running `npm run dev` if there is one, otherwise starts it.
  webServer: {
    command: "npm run dev",
    url: `http://localhost:${PORT}/login`,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
