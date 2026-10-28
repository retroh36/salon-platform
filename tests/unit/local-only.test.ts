import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { notLocal } from "@/scripts/local-only";

// Tests, seeds and resets never touch a hosted database: each refuses to
// start unless every database setting is on this machine.
describe("only the local database", () => {
  it("lets the local database through, and no settings at all", () => {
    expect(notLocal({})).toBeNull();
    expect(notLocal({ NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321", SUPABASE_SECRET_KEY: "sb_secret_x" })).toBeNull();
    expect(notLocal({ NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54321", DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:54322/postgres" })).toBeNull();
  });

  it("refuses a hosted project or database, by any of its settings, naming only the host", () => {
    const hosted = notLocal({ NEXT_PUBLIC_SUPABASE_URL: "https://abcdefgh.supabase.co" });
    expect(hosted).toContain("NEXT_PUBLIC_SUPABASE_URL points at abcdefgh.supabase.co");
    expect(hosted).toContain("npm run demo:db");
    const pooler = notLocal({ NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321", DEMO_DATABASE_URL: "postgresql://postgres.abc:s3cret@aws-0-us-east-1.pooler.supabase.com:5432/postgres" });
    expect(pooler).toContain("DEMO_DATABASE_URL points at aws-0-us-east-1.pooler.supabase.com");
    expect(pooler).not.toContain("s3cret");
    expect(notLocal({ SUPABASE_URL: "http://127.0.0.1.example.com" })).toContain("isn't this machine");
    expect(notLocal({ DATABASE_URL: "not a url" })).toContain("isn't a URL");
  });

  it("refuses another project's settings file outright", () => {
    expect(notLocal({ MAESTRA_ENV_FILE: ".env.demo.local", NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321" })).toContain("MAESTRA_ENV_FILE is set");
  });

  it("is checked by every test runner, seed and reset before it starts", () => {
    const read = (path: string) => readFileSync(path, "utf8");
    for (const path of ["vitest.config.mts", "playwright.config.ts", "e2e-week/playwright.config.ts", "playwright.demo.config.ts", "scripts/test-week.ts", "scripts/screenshots.ts"]) {
      expect(read(path), path).toMatch(/requireLocal\(/);
    }
    expect(read("scripts/backup-drill.sh")).toContain("scripts/require-local.ts");
    const scripts = JSON.parse(read("package.json")).scripts as Record<string, string>;
    for (const name of ["seed:demo", "db:reset"]) expect(scripts[name].startsWith("node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/require-local.ts"), name).toBe(true);
  });
});
