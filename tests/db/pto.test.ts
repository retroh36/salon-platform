// Time off types and PTO: each salon starts with four types, the type sets
// the reason, saving the list archives what's left out, the policy and the
// types are for whoever has `settings`, adjustments for whoever manages the
// team (always with a reason, never an owner's by a manager), and who reads
// adjustments.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { knowledgeFor, type Asker } from "@/lib/denise/knowledge";
import { addDays, todayIn } from "@/lib/scheduling/time";
import { admin, createOtherSalon, DEFAULT_PERMISSIONS, signIn, SEED, type Client } from "./helpers";

const B = SEED.business;
const started = new Date().toISOString();
let owner: Client;
let manager: Client;
let frontDesk: Client;
let gil: Client;
let typesBefore: { id: string; name: string; reason: string; uses_pto: boolean; position: number }[] = [];

beforeAll(async () => {
  [owner, manager, frontDesk, gil] = await Promise.all([
    signIn("owner@mapleandash.test"),
    signIn("manager@mapleandash.test"),
    signIn("frontdesk@mapleandash.test"),
    signIn("gil@mapleandash.test"),
  ]);
  typesBefore = (await admin.from("time_off_types").select("id, name, reason, uses_pto, position").eq("business_id", B).is("archived_at", null).order("position")).data!;
});

afterAll(async () => {
  await admin.from("staff_time_off").delete().eq("business_id", B).gte("created_at", started);
  await admin.from("time_off_types").delete().eq("business_id", B).gte("created_at", started);
  for (const t of typesBefore) await admin.from("time_off_types").update({ name: t.name, reason: t.reason as "other", uses_pto: t.uses_pto, position: t.position, archived_at: null }).eq("id", t.id);
  await admin.from("pto_adjustments").delete().eq("business_id", B).gte("created_at", started);
});

describe("types of time off", () => {
  it("are four to start with for a new salon", async () => {
    const other = await createOtherSalon();
    const { data } = await admin.from("time_off_types").select("name, reason, uses_pto").eq("business_id", other.businessId).order("position");
    expect(data).toEqual([
      { name: "Vacation", reason: "vacation", uses_pto: true },
      { name: "Sick", reason: "sick", uses_pto: false },
      { name: "Personal", reason: "personal", uses_pto: true },
      { name: "Other", reason: "other", uses_pto: false },
    ]);
  });

  it("set the reason, and time off saved with only a reason takes the first type with it", async () => {
    const { data: types } = await admin.from("time_off_types").select("id, reason").eq("business_id", B).eq("name", "Bereavement").single();
    const asked = await gil.rpc("request_time_off", { p_starts_on: "2027-03-02", p_ends_on: "2027-03-02", p_reason: "vacation", p_type_id: types!.id });
    expect(asked.error).toBeNull();
    const { data: row } = await admin.from("staff_time_off").select("reason, type_id").eq("id", asked.data!).single();
    expect(row).toEqual({ reason: "other", type_id: types!.id });
    // The managers' notice names the type.
    const { data: notice } = await admin.from("notifications").select("body").eq("template", "time_off_requested").gte("created_at", started).limit(1).single();
    expect(notice!.body).toContain("asked for time off: Bereavement,");

    const plain = await gil.rpc("request_time_off", { p_starts_on: "2027-03-09", p_ends_on: "2027-03-09", p_reason: "sick" });
    const { data: sick } = await admin.from("staff_time_off").select("type_id").eq("id", plain.data!).single();
    expect(sick!.type_id).toBe(typesBefore.find((t) => t.name === "Sick")!.id);
  });

  it("are saved as a whole list by whoever has settings, archiving what's left out", async () => {
    const list = typesBefore.map((t) => ({ id: t.id, name: t.name, reason: t.reason, uses_pto: t.uses_pto }));
    const bereavement = list.find((t) => t.name === "Bereavement")!;
    const next = [...list.filter((t) => t !== bereavement), { id: null, name: "Jury duty", reason: "other", uses_pto: false }];
    expect((await frontDesk.rpc("save_time_off_types", { p_business_id: B, p_types: next })).error?.code).toBe("42501");
    expect((await owner.rpc("save_time_off_types", { p_business_id: B, p_types: [...next, { id: null, name: "jury duty ", reason: "other", uses_pto: false }] })).error?.hint).toBe("duplicate");
    expect((await owner.rpc("save_time_off_types", { p_business_id: B, p_types: next })).error).toBeNull();
    const { data } = await admin.from("time_off_types").select("name, archived_at").eq("business_id", B).order("position");
    expect(data!.filter((t) => !t.archived_at).map((t) => t.name)).toEqual(["Vacation", "Sick", "Personal", "Other", "Jury duty"]);
    expect(data!.find((t) => t.name === "Bereavement")!.archived_at).not.toBeNull();
    // An archived type can't be asked for.
    const asked = await gil.rpc("request_time_off", { p_starts_on: "2027-03-16", p_ends_on: "2027-03-16", p_reason: "other", p_type_id: bereavement.id! });
    expect(asked.error?.hint).toBe("type");
  });

  it("must belong to the salon", async () => {
    const other = await createOtherSalon();
    const { data: theirs } = await admin.from("time_off_types").select("id").eq("business_id", other.businessId).limit(1).single();
    const asked = await gil.rpc("request_time_off", { p_starts_on: "2027-03-23", p_ends_on: "2027-03-23", p_reason: "vacation", p_type_id: theirs!.id });
    expect(asked.error).not.toBeNull();
  });
});

describe("the PTO policy", () => {
  it("is saved by whoever has settings, and read by the team", async () => {
    const { data: before } = await admin.from("pto_policies").select("*").eq("business_id", B).single();
    const policy = { ...before!, yearly_minutes: 96 * 60 };
    try {
      expect((await manager.rpc("save_pto_policy", { p_business_id: B, p_policy: policy })).error).toBeNull();
      expect((await frontDesk.rpc("save_pto_policy", { p_business_id: B, p_policy: policy })).error?.code).toBe("42501");
      expect((await owner.rpc("save_pto_policy", { p_business_id: B, p_policy: { ...policy, carry_over: "sometimes" } })).error?.hint).toBe("policy");
      expect((await gil.from("pto_policies").select("yearly_minutes").single()).data!.yearly_minutes).toBe(96 * 60);
    } finally {
      await admin.from("pto_policies").update(before!).eq("business_id", B);
    }
  });
});

describe("adjustments", () => {
  it("need the team permission and a reason, and never an owner's by a manager", async () => {
    const args = { p_business_id: B, p_staff_id: SEED.staff.gil, p_minutes: 240, p_on_date: "2026-11-01", p_reason: "Correction" };
    expect((await frontDesk.rpc("adjust_pto", args)).error?.code).toBe("42501");
    expect((await manager.rpc("adjust_pto", { ...args, p_reason: "" })).error?.hint).toBe("reason");
    expect((await manager.rpc("adjust_pto", { ...args, p_minutes: 0 })).error?.hint).toBe("minutes");
    expect((await manager.rpc("adjust_pto", { ...args, p_staff_id: SEED.staff.owner })).error?.code).toBe("42501");
    const done = await manager.rpc("adjust_pto", args);
    expect(done.error).toBeNull();
    const { data } = await admin.from("pto_adjustments").select("minutes, reason, by_staff_id").eq("id", done.data!).single();
    expect(data).toEqual({ minutes: 240, reason: "Correction", by_staff_id: SEED.staff.manager });
  });

  it("are read by the person and those who manage the team, not the rest", async () => {
    expect((await gil.from("pto_adjustments").select("staff_id")).data!.every((a) => a.staff_id === SEED.staff.gil)).toBe(true);
    expect((await gil.from("pto_adjustments").select("id")).data!.length).toBeGreaterThan(0);
    expect((await frontDesk.from("pto_adjustments").select("id").eq("staff_id", SEED.staff.gil)).data).toEqual([]);
    expect((await manager.from("pto_adjustments").select("id").eq("staff_id", SEED.staff.gil)).data!.length).toBeGreaterThan(0);
  });

  it("can't be written directly", async () => {
    const { error } = await manager.from("pto_adjustments").insert({ business_id: B, staff_id: SEED.staff.gil, on_date: "2026-11-01", minutes: 60, reason: "Direct", by_staff_id: SEED.staff.manager });
    expect(error).not.toBeNull();
  });
});

describe("Denise's answers", () => {
  const TZ = "America/Chicago";
  const today = todayIn(TZ);
  const asker = (role: Asker["role"], staffId: string): Asker => ({ role, permissions: DEFAULT_PERMISSIONS[role], staffId, businessId: B, location: { id: SEED.location, timezone: TZ }, salon: "Maple & Ash", today });
  type Balance = { first_name: string; pto: { balance: string } | string; taken_by_type: { type: string; days: number }[] };

  it("tell anyone their own PTO, and only owners and managers someone else's", async () => {
    const mine = (await knowledgeFor(gil, asker("stylist", SEED.staff.gil)).pto(null)) as Balance;
    expect(mine.first_name).toBe("Gil");
    expect(typeof mine.pto).toBe("object");
    expect(await knowledgeFor(gil, asker("stylist", SEED.staff.gil)).pto("Nola")).toEqual({ error: "I can only tell you about your own time off and PTO. Owners and managers can see everyone's." });
    expect(await knowledgeFor(frontDesk, asker("front_desk", SEED.staff.frontDesk)).pto("Nola")).toHaveProperty("error");

    // The seed has Nola off sick in the spring.
    const nola = (await knowledgeFor(manager, asker("manager", SEED.staff.manager)).pto("nola")) as Balance;
    expect(nola.first_name).toBe("Nola");
    expect(nola.taken_by_type.find((t) => t.type === "Sick")?.days).toBeGreaterThan(0);
    expect(JSON.stringify(nola)).not.toMatch(/note|@/i);
  });

  it("say who's off: everyone's for managers, only your own for anyone else", async () => {
    const to = addDays(today, 60);
    const all = (await knowledgeFor(manager, asker("manager", SEED.staff.manager)).timeOff(today, to)) as { off: { first_name: string; status: string }[] };
    expect(new Set(all.off.map((o) => o.first_name)).size).toBeGreaterThan(1);
    expect(all.off.some((o) => o.status === "asked for, waiting")).toBe(true);
    const own = (await knowledgeFor(gil, asker("stylist", SEED.staff.gil)).timeOff(today, to)) as { off: { first_name: string }[]; only_yours: string };
    expect(own.off.every((o) => o.first_name === "Gil")).toBe(true);
    expect(own.only_yours).toBeTruthy();
    expect(await knowledgeFor(manager, asker("manager", SEED.staff.manager)).timeOff(today, addDays(today, 90))).toBe("Ask about 62 days or fewer at a time.");
  });
});
