import { describe, expect, it } from "vitest";
import { outboxOpen } from "@/lib/dev-outbox";

const LOCAL = "http://127.0.0.1:54321";
const HOSTED = "https://abcdefgh.supabase.co";

describe("outboxOpen", () => {
  it("is open in development and on the demo", () => {
    expect(outboxOpen({ NODE_ENV: "development" })).toBe(true);
    expect(outboxOpen({ NODE_ENV: "production", DEMO_MODE: "true", NEXT_PUBLIC_SUPABASE_URL: HOSTED })).toBe(true);
  });

  it("is closed in production", () => {
    expect(outboxOpen({ NODE_ENV: "production", NEXT_PUBLIC_SUPABASE_URL: HOSTED })).toBe(false);
    expect(outboxOpen({ NODE_ENV: "production", NEXT_PUBLIC_SUPABASE_URL: LOCAL })).toBe(false);
  });

  it("opens on the browser tests' production build, only against a local database", () => {
    expect(outboxOpen({ NODE_ENV: "production", MAESTRA_TEST_SERVER: "true", NEXT_PUBLIC_SUPABASE_URL: LOCAL })).toBe(true);
    expect(outboxOpen({ NODE_ENV: "production", MAESTRA_TEST_SERVER: "true", NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54321" })).toBe(true);
    expect(outboxOpen({ NODE_ENV: "production", MAESTRA_TEST_SERVER: "true", NEXT_PUBLIC_SUPABASE_URL: HOSTED })).toBe(false);
    expect(outboxOpen({ NODE_ENV: "production", MAESTRA_TEST_SERVER: "true" })).toBe(false);
    expect(outboxOpen({ NODE_ENV: "production", MAESTRA_TEST_SERVER: "1", NEXT_PUBLIC_SUPABASE_URL: LOCAL })).toBe(false);
  });
});
