import { defineConfig, devices } from "@playwright/test";

// npm run test:demo: the public demo's own checks (e2e-demo/). Locally it
// runs a server with DEMO_MODE=true on port 3400 (build folder .next-demo)
// against the local database; with DEMO_URL set it checks a deployed demo
// instead (a Vercel preview, then production), changing nothing there but
// a client sign-in code. VERCEL_AUTOMATION_BYPASS_SECRET (in .env.local)
// gets it past a preview's protection; it's never printed.
try {
  process.loadEnvFile(".env.local");
} catch {
  // Rely on the environment instead.
}
delete process.env.ANTHROPIC_API_KEY;

const PORT = 3400;
// Set but empty, like the API key, so the local server is set up as the
// demo is: never the importer's credentials.
const noPhorest = Object.fromEntries(Object.keys(process.env).filter((k) => k.startsWith("PHOREST_")).map((k) => [k, ""]));
const remote = process.env.DEMO_URL?.replace(/\/+$/, "");
const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;

export default defineConfig({
  testDir: "./e2e-demo",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  timeout: 60_000,
  use: {
    baseURL: remote ?? `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    extraHTTPHeaders: remote && bypass ? { "x-vercel-protection-bypass": bypass, "x-vercel-set-bypass-cookie": "true" } : undefined,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: remote
    ? undefined
    : {
        command: `next dev --port ${PORT}`,
        url: `http://localhost:${PORT}/login`,
        reuseExistingServer: true,
        timeout: 180_000,
        env: { ...noPhorest, ANTHROPIC_API_KEY: "", DEMO_MODE: "true", NEXT_DIST_DIR: ".next-demo", NEXT_PUBLIC_SITE_URL: `http://localhost:${PORT}` },
      },
});
