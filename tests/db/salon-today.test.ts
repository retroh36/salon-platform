// "Today" in the database is the salon's day, not UTC's: Denise's daily
// limit, online event inquiries and photo consent. Checked on a salon
// whose date right now differs from UTC's (ahead or behind, depending on
// the hour), so it holds at any time of day.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { todayIn } from "@/lib/scheduling/time";
import { admin, createOtherSalon, signIn, type Client } from "./helpers";

let other: Awaited<ReturnType<typeof createOtherSalon>>;
let owner: Client;
// UTC-12 before noon UTC (yesterday there), UTC+14 after (tomorrow there).
const TZ = new Date().getUTCHours() < 12 ? "Etc/GMT+12" : "Etc/GMT-14";
const salonToday = () => todayIn(TZ);

beforeAll(async () => {
  other = await createOtherSalon();
  owner = await signIn(other.email);
  await admin.from("locations").update({ timezone: TZ }).eq("id", other.locationId);
  expect(salonToday()).not.toBe(todayIn("UTC"));
});

afterAll(async () => {
  await admin.from("ai_usage").delete().eq("business_id", other.businessId);
  await other.cleanup();
});

describe("the salon's today", () => {
  it("is the day Denise's usage counts toward, and what her limit checks", async () => {
    expect((await admin.rpc("record_ai_usage", { p_business_id: other.businessId, p_model: "claude-haiku-5-5", p_feature: "chat", p_input: 1000, p_output: 200, p_cache_read: 0 })).error).toBeNull();
    const { data: rows } = await admin.from("ai_usage").select("day").eq("business_id", other.businessId);
    expect(rows).toEqual([{ day: salonToday() }]);
    const { data: today } = await admin.rpc("ai_usage_today", { p_business_id: other.businessId });
    expect(Number(today![0].used)).toBe(1200);
  });

  it("takes an online event inquiry for today, and refuses yesterday", async () => {
    await admin.from("event_settings").upsert({ business_id: other.businessId, inquiries_enabled: true });
    const inquiry = (date: string) => admin.rpc("save_event_inquiry", { p_business_id: other.businessId, p_input: { first_name: "Tia", last_name: "Today", phone: "(489) 555-0199", event_date: date, kind: "wedding" } });
    const { error } = await inquiry(salonToday());
    expect(error).toBeNull();
    const yesterday = new Date(Date.parse(`${salonToday()}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
    expect((await inquiry(yesterday)).error?.code).toBe("22023");
  });

  it("dates photo consent up to today at the salon", async () => {
    const { data: c } = await admin.from("clients").insert({ business_id: other.businessId, first_name: "Phoebe", last_name: "Consent" }).select("id").single();
    expect((await owner.rpc("set_photo_consent", { p_client_id: c!.id, p_on: salonToday() })).error).toBeNull();
    const tomorrow = new Date(Date.parse(`${salonToday()}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    expect((await owner.rpc("set_photo_consent", { p_client_id: c!.id, p_on: tomorrow })).error?.code).toBe("22023");
  });
});
