import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEMO_AI_TOKENS, DEMO_CLIENT, DEMO_LOGINS, DEMO_OFF, demoTokenLimit, isDemo, isDemoAccount, safePath } from "@/lib/demo";
import { usageToday } from "@/lib/denise/usage";
import { inviteMember, resetMemberPassword } from "@/lib/team-logins";

afterEach(() => vi.unstubAllEnvs());

describe("demo mode", () => {
  it("is on only with DEMO_MODE=true", () => {
    expect(isDemo({ DEMO_MODE: "true" })).toBe(true);
    for (const value of [undefined, "", "false", "1", "TRUE"]) expect(isDemo({ DEMO_MODE: value })).toBe(false);
  });

  it("offers only accounts the seed creates", () => {
    const seed = readFileSync("supabase/seed.sql", "utf8") + readFileSync("supabase/seed-large.sql", "utf8");
    for (const l of DEMO_LOGINS) expect(seed).toContain(l.email);
    expect(seed).toContain(DEMO_CLIENT.slug);
    expect(isDemoAccount("Owner@MapleAndAsh.test")).toBe(true);
    expect(isDemoAccount("gil@mapleandash.test")).toBe(false);
    expect(isDemoAccount(null)).toBe(false);
  });

  it("keeps tokens out of the page a note was sent from", () => {
    expect(safePath("/pay/abc123")).toBe("/pay/:token");
    expect(safePath("/card/abc123?x=1")).toBe("/card/:token");
    expect(safePath("/event/abc123")).toBe("/event/:token");
    expect(safePath("/unsubscribe/abc123")).toBe("/unsubscribe/:token");
    expect(safePath("/book/maple-and-ash/manage/abc123")).toBe("/book/maple-and-ash/manage/:token");
    expect(safePath("/book/maple-and-ash/account/link?v=1&t=secret")).toBe("/book/maple-and-ash/account/link");
    expect(safePath("/events/1234/edit")).toBe("/events/1234/edit");
    expect(safePath("/calendar?date=2026-10-27")).toBe("/calendar");
    expect(safePath("x".repeat(400)).length).toBeLessThanOrEqual(300);
  });

  it("gives Denise a small allowance, which DEMO_AI_DAILY_TOKENS can change", () => {
    expect(demoTokenLimit({})).toBe(DEMO_AI_TOKENS);
    expect(demoTokenLimit({ DEMO_AI_DAILY_TOKENS: "" })).toBe(DEMO_AI_TOKENS);
    expect(demoTokenLimit({ DEMO_AI_DAILY_TOKENS: "abc" })).toBe(DEMO_AI_TOKENS);
    expect(demoTokenLimit({ DEMO_AI_DAILY_TOKENS: "100000" })).toBe(100_000);
    expect(demoTokenLimit({ DEMO_AI_DAILY_TOKENS: "0" })).toBe(0);
  });

  it("holds Denise to the allowance whatever the salon's own limit says", async () => {
    const admin = { rpc: async () => ({ data: [{ used: 10, daily_limit: 5_000_000 }], error: null }) } as never;
    expect(await usageToday(admin, "b")).toEqual({ used: 10, limit: 5_000_000 });
    vi.stubEnv("DEMO_MODE", "true");
    expect(await usageToday(admin, "b")).toEqual({ used: 10, limit: DEMO_AI_TOKENS });
    vi.stubEnv("DEMO_AI_DAILY_TOKENS", "1000");
    expect(await usageToday(admin, "b")).toEqual({ used: 10, limit: 1000 });
  });

  it("sends no invites or password emails", async () => {
    vi.stubEnv("DEMO_MODE", "true");
    const supabase = new Proxy({}, { get: () => { throw new Error("nothing should be called"); } }) as never;
    const owner = { id: "o", role: "owner" as const, business_id: "b", permissions: [] };
    expect(await inviteMember(supabase, owner, "s")).toEqual({ ok: false, message: DEMO_OFF.invites });
    expect(await resetMemberPassword(supabase, owner, "s")).toEqual({ ok: false, message: DEMO_OFF.passwords });
  });
});
