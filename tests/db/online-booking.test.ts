// Online booking: the server-only functions, the tables only the server
// reads, settings RLS, and booking through the same rules as the calendar,
// including two people trying to book the same time.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sha256 } from "@/lib/online-booking/security";
import { bookOnline, cancelOnline, patchTestProblems } from "@/lib/scheduling/online-book";
import { addDays, fromLocal, startOfWeek, todayIn } from "@/lib/scheduling/time";
import { admin, anon, createOtherSalon, SEED, signIn, type Client } from "./helpers";

const B = SEED.business;
const L = SEED.location;
const TZ = "America/Chicago";
const location = { id: L, timezone: TZ };
// A Tuesday far past the demo month, so the day is clear.
const DAY = addDays(startOfWeek(todayIn(TZ)), 7 * 33 + 1);
const at = (hour: number, minute = 0) => fromLocal(DAY, hour * 60 + minute, TZ)!;
const RUN = `Ob${crypto.randomUUID().slice(0, 8)}`;
const hash = (s: string) => sha256(`${RUN}-${s}`);

let owner: Client;
let manager: Client;
let frontDesk: Client;
let other: Awaited<ReturnType<typeof createOtherSalon>>;
let otherOwner: Client;
let clientId: string;
let mensCut: string;
let balayage: string;

beforeAll(async () => {
  other = await createOtherSalon();
  [owner, manager, frontDesk, otherOwner] = await Promise.all([
    signIn("owner@mapleandash.test"),
    signIn("manager@mapleandash.test"),
    signIn("frontdesk@mapleandash.test"),
    signIn(other.email),
  ]);
  const { data: c } = await admin.from("clients").insert({ business_id: B, first_name: `${RUN}Client`, phone: "(489) 555-0177", email: `${RUN.toLowerCase()}@example.com` }).select("id").single();
  clientId = c!.id;
  const { data: services } = await admin.from("services").select("id, name").eq("business_id", B).in("name", ["Men's Cut", "Balayage"]);
  mensCut = services!.find((s) => s.name === "Men's Cut")!.id;
  balayage = services!.find((s) => s.name === "Balayage")!.id;
});

afterAll(async () => {
  await admin.from("appointments").delete().eq("business_id", B).like("notes", `${RUN}%`);
  await admin.from("appointments").delete().eq("client_id", clientId);
  await admin.from("clients").delete().like("first_name", `${RUN}%`);
  await other?.cleanup();
});

const visit = (staffId: string | null, serviceIds = [mensCut]) => ({ serviceIds, staffId, stylistIds: [SEED.staff.nola, SEED.staff.gil, SEED.staff.shae] });

describe("server-only functions", () => {
  it("can't be called by the public or by staff", async () => {
    for (const client of [anon, frontDesk, owner]) {
      const book = await client.rpc("save_online_appointment", {
        p_location_id: L, p_appointment_id: null!, p_client_id: clientId, p_notes: "", p_items: [], p_expected_version: 0, p_manage_token_hash: hash("x"),
      });
      expect(book.error?.code).toBe("42501");
      expect((await client.rpc("cancel_online_appointment", { p_appointment_id: crypto.randomUUID(), p_manage_token_hash: hash("x") })).error?.code).toBe("42501");
      expect((await client.rpc("find_online_client", { p_business_id: B, p_phone_digits: "3125550100", p_email: "", p_first_name: "", p_last_name: "", p_phone: "" })).error?.code).toBe("42501");
      expect((await client.rpc("hit_rate_limit", { p_key: "x", p_limit: 1, p_window_seconds: 60 })).error?.code).toBe("42501");
    }
  });

  it("keeps codes, the outbox and rate limits away from everyone but the server", async () => {
    await admin.from("outbox_messages").insert({ business_id: B, channel: "sms", to_address: "4895550177", body: `${RUN} code` });
    for (const client of [anon, frontDesk, owner]) {
      for (const table of ["online_verifications", "outbox_messages", "rate_limits"] as const) {
        const { data } = await client.from(table).select("*").limit(5);
        expect(data ?? []).toEqual([]);
      }
    }
    await admin.from("outbox_messages").delete().eq("body", `${RUN} code`);
  });
});

describe("rate limits", () => {
  it("allow so many hits per window, then refuse", async () => {
    const key = `${RUN}-limit`;
    const hits = [];
    for (let i = 0; i < 4; i++) hits.push((await admin.rpc("hit_rate_limit", { p_key: key, p_limit: 3, p_window_seconds: 3600 })).data);
    expect(hits).toEqual([true, true, true, false]);
    await admin.from("rate_limits").delete().eq("key", key);
  });
});

describe("finding the client", () => {
  const find = (phone: string, email: string, create?: [string, string]) =>
    admin.rpc("find_online_client", { p_business_id: B, p_phone_digits: phone, p_email: email, p_first_name: create?.[0] ?? "", p_last_name: create?.[1] ?? "", p_phone: phone ? `(${phone.slice(0, 3)}) ${phone.slice(3, 6)}-${phone.slice(6)}` : "" });

  it("matches a phone number by its digits, or an email in any case", async () => {
    expect((await find("4895550177", "")).data).toBe(clientId);
    expect((await find("14895550177", "")).data).toBe(clientId);
    expect((await find("", `${RUN.toUpperCase()}@EXAMPLE.COM`)).data).toBe(clientId);
    expect((await find("4895550199", "")).data).toBeNull();
  });

  it("adds a new client when there's none, and only in this salon", async () => {
    const { data: id } = await find("4895550198", "", [`${RUN}New`, "Person"]);
    const { data: made } = await admin.from("clients").select("business_id, first_name, last_name, phone").eq("id", id!).single();
    expect(made).toEqual({ business_id: B, first_name: `${RUN}New`, last_name: "Person", phone: "(489) 555-0198" });
    const elsewhere = await admin.rpc("find_online_client", { p_business_id: other.businessId, p_phone_digits: "4895550177", p_email: "", p_first_name: "", p_last_name: "", p_phone: "" });
    expect(elsewhere.data).toBeNull();
  });
});

describe("booking online", () => {
  it("books with the booking rules, marked online, at the stylist's level price, with the deposit", async () => {
    // Gil works Wednesdays.
    const wednesday = fromLocal(addDays(DAY, 1), 11 * 60, TZ)!;
    const result = await bookOnline(admin, location, { clientId, notes: `${RUN} one`, request: visit(SEED.staff.gil), start: wednesday, manageTokenHash: hash("one") });
    expect(result.ok).toBe(true);
    const { data } = await admin.from("appointments").select("source, created_by, manage_token_hash, appointment_items(staff_id, price_cents, resource_id)").eq("id", result.ok ? result.appointmentId : "").single();
    // Gil is a Master: $45 menu price, $50 (rounded from 1.15 times) for Masters.
    expect(data).toMatchObject({ source: "online", created_by: null, manage_token_hash: hash("one") });
    expect(data!.appointment_items).toEqual([{ staff_id: SEED.staff.gil, price_cents: 5000, resource_id: expect.any(String) }]);
  });

  it("works out a percentage deposit from the price booked", async () => {
    const result = await bookOnline(admin, location, { clientId, notes: `${RUN} deposit`, request: visit(SEED.staff.sandra, [balayage]), start: at(9), manageTokenHash: hash("deposit") });
    // Patch tests: the client has none, so color is refused online.
    expect(result).toMatchObject({ ok: false, error: "patch_test", state: "missing" });
    await admin.from("client_patch_tests").insert({ business_id: B, client_id: clientId, tested_at: new Date(Date.now() - 7 * 86_400_000).toISOString(), result: "no_reaction", products: "Test", performed_by: SEED.staff.sandra });
    // It lasts six months: fine seven weeks out, expired by the far-off day.
    const soon = fromLocal(addDays(startOfWeek(todayIn(TZ)), 7 * 7 + 1), 9 * 60, TZ)!;
    expect(await patchTestProblems(admin, location, clientId, [balayage], soon)).toBeNull();
    expect(await patchTestProblems(admin, location, clientId, [balayage], at(9))).toMatchObject({ state: "expired" });
    const booked = await bookOnline(admin, location, { clientId, notes: `${RUN} deposit`, request: visit(SEED.staff.sandra, [balayage]), start: soon, manageTokenHash: hash("deposit") });
    expect(booked.ok).toBe(true);
    const { data } = await admin.from("appointments").select("deposit_cents, appointment_items(price_cents)").eq("id", booked.ok ? booked.appointmentId : "").single();
    expect(data!.deposit_cents).toBe(Math.round(data!.appointment_items[0].price_cents * 0.25));
  });

  it("never lets two people book the same time", async () => {
    const attempts = await Promise.all(
      [1, 2, 3].map((n) => bookOnline(admin, location, { clientId, notes: `${RUN} race ${n}`, request: visit(SEED.staff.nola), start: at(14), manageTokenHash: hash(`race${n}`) })),
    );
    expect(attempts.filter((a) => a.ok)).toHaveLength(1);
    expect(attempts.filter((a) => !a.ok).map((a) => !a.ok && a.error)).toEqual(["taken", "taken"]);
    const { data } = await admin.from("appointment_items").select("id").eq("staff_id", SEED.staff.nola).eq("starts_at", at(14).toISOString());
    expect(data).toHaveLength(1);
  });

  it("with no preference, gives the time to another free stylist instead", async () => {
    const first = await bookOnline(admin, location, { clientId, notes: `${RUN} np1`, request: visit(null), start: at(15), manageTokenHash: hash("np1") });
    const second = await bookOnline(admin, location, { clientId, notes: `${RUN} np2`, request: visit(null), start: at(15), manageTokenHash: hash("np2") });
    expect(first.ok && second.ok).toBe(true);
    expect(first.ok && second.ok && first.items[0].staffId !== second.items[0].staffId).toBe(true);
  });

  it("reschedules and cancels only with the booking's own link", async () => {
    const booked = await bookOnline(admin, location, { clientId, notes: `${RUN} move`, request: visit(SEED.staff.nola), start: at(10), manageTokenHash: hash("move") });
    if (!booked.ok) throw new Error("not booked");
    const wrong = await bookOnline(admin, location, { appointmentId: booked.appointmentId, clientId, notes: null, request: visit(SEED.staff.nola), start: at(13), manageTokenHash: hash("guess") });
    expect(wrong).toEqual({ ok: false, error: "not_found" });
    const moved = await bookOnline(admin, location, { appointmentId: booked.appointmentId, clientId, notes: `${RUN} move`, request: visit(SEED.staff.nola), start: at(13), manageTokenHash: hash("move") });
    expect(moved.ok).toBe(true);
    const { data: after } = await admin.from("appointments").select("starts_at").eq("id", booked.appointmentId).single();
    expect(new Date(after!.starts_at).getTime()).toBe(at(13).getTime());

    expect(await cancelOnline(admin, booked.appointmentId, hash("guess"))).toEqual({ ok: false });
    expect(await cancelOnline(admin, booked.appointmentId, hash("move"))).toEqual({ ok: true });
    const { data: done } = await admin.from("appointments").select("status, cancel_reason").eq("id", booked.appointmentId).single();
    expect(done).toEqual({ status: "canceled", cancel_reason: "Canceled online by the client" });
    // Canceled visits can't be moved online.
    expect(await bookOnline(admin, location, { appointmentId: booked.appointmentId, clientId, notes: null, request: visit(SEED.staff.nola), start: at(13, 30), manageTokenHash: hash("move") })).toEqual({ ok: false, error: "not_found" });
  });

  it("refuses times outside the stylist's hours", async () => {
    expect(await bookOnline(admin, location, { clientId, notes: `${RUN} late`, request: visit(SEED.staff.nola), start: at(21), manageTokenHash: hash("late") })).toEqual({ ok: false, error: "taken" });
  });
});

describe("settings and the log", () => {
  it("members see the settings; only owners change them; other salons see nothing", async () => {
    expect((await frontDesk.from("online_booking_settings").select("enabled").eq("business_id", B).single()).data).toEqual({ enabled: true });
    const byManager = await manager.from("online_booking_settings").update({ window_days: 5 }).eq("business_id", B).select("business_id");
    expect(byManager.data).toEqual([]);
    const byOwner = await owner.from("online_booking_settings").update({ window_days: 61 }).eq("business_id", B).select("window_days");
    expect(byOwner.data).toEqual([{ window_days: 61 }]);
    await admin.from("online_booking_settings").update({ window_days: 60 }).eq("business_id", B);
    expect((await otherOwner.from("online_booking_settings").select("business_id").eq("business_id", B)).data).toEqual([]);
  });

  it("owners and managers read the online booking log; the front desk doesn't", async () => {
    await admin.from("online_booking_log").insert({ business_id: B, action: "booked", ip_hash: RUN });
    for (const [client, sees] of [[owner, 1], [manager, 1], [frontDesk, 0], [otherOwner, 0]] as const) {
      const { data } = await client.from("online_booking_log").select("id").eq("ip_hash", RUN);
      expect(data).toHaveLength(sees);
    }
    await admin.from("online_booking_log").delete().eq("ip_hash", RUN);
  });

  it("rejects booking addresses that aren't lowercase words and hyphens", async () => {
    expect((await admin.from("businesses").update({ slug: "Maple & Ash" }).eq("id", B)).error?.code).toBe("23514");
    expect((await admin.from("businesses").update({ slug: "maple-and-ash" }).eq("id", other.businessId)).error?.code).toBe("23505");
  });
});
