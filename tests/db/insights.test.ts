// What Denise learns: computed from the demo history, stored in `insights`,
// readable by role (stylists see their own durations and no spend), and
// written only by the server.
import { beforeAll, describe, expect, it } from "vitest";
import { computeInsights, recomputeForVisit } from "@/lib/insights/compute";
import type { DurationInsight } from "@/lib/insights/durations";
import type { SalonInsight } from "@/lib/insights/salon";
import { admin, createOtherSalon, SEED, signIn, type Client } from "./helpers";

const B = SEED.business;
let owner: Client;
let frontDesk: Client;
let bridget: Client;

beforeAll(async () => {
  [owner, frontDesk, bridget] = await Promise.all([signIn("owner@mapleandash.test"), signIn("frontdesk@mapleandash.test"), signIn("bridget@mapleandash.test")]);
  await computeInsights(admin, B);
});

async function serviceId(name: string) {
  return (await admin.from("services").select("id").eq("business_id", B).eq("name", name).single()).data!.id;
}

describe("learning from the demo history", () => {
  it("knows Bridget takes longer than the menu for balayage, and suggests a length", async () => {
    const { data } = await admin.from("insights").select("data").eq("business_id", B).eq("kind", "duration").eq("key", `${SEED.staff.bridget}:${await serviceId("Balayage")}`).single();
    const d = data!.data as unknown as DurationInsight;
    expect(d.trusted).toBe(true);
    expect(d.medianMinutes).toBeGreaterThan(d.menuMinutes + 10);
    expect(d.suggestedMinutes! % 5).toBe(0);
    expect(d.suggestedMinutes).toBeGreaterThanOrEqual(d.medianMinutes);
  });

  it("knows Shae is quick on men's cuts and getting faster on women's cuts", async () => {
    const get = async (name: string) =>
      (await admin.from("insights").select("data").eq("business_id", B).eq("kind", "duration").eq("key", `${SEED.staff.shae}:${await serviceId(name)}`).single()).data!.data as unknown as DurationInsight;
    const mens = await get("Men's Cut");
    expect(mens.medianMinutes).toBeLessThan(mens.menuMinutes);
    expect((await get("Women's Cut & Style")).trend).toBe("faster");
  });

  it("has every client with visits, and the salon's patterns", async () => {
    const { count } = await admin.from("insights").select("key", { count: "exact", head: true }).eq("business_id", B).eq("kind", "client");
    expect(count).toBeGreaterThan(400);
    const { data } = await admin.from("insights").select("data").eq("business_id", B).eq("kind", "salon").eq("key", SEED.location).single();
    const s = data!.data as unknown as SalonInsight;
    expect(s.busiest).toHaveLength(3);
    expect(s.weekdays.length).toBeGreaterThanOrEqual(5);
    expect(s.noShowRate).toBeGreaterThan(0);
    expect(s.rebooking.length).toBe(7);
  });
});

describe("who can read them", () => {
  const kinds = async (client: Client) => {
    const { data } = await client.from("insights").select("kind, key").eq("business_id", B);
    return data!;
  };

  it("the front desk and owners read everything", async () => {
    for (const client of [owner, frontDesk]) {
      for (const kind of ["duration", "client", "client_spend", "salon"]) {
        const { count } = await client.from("insights").select("key", { count: "exact", head: true }).eq("business_id", B).eq("kind", kind);
        expect(count, kind).toBeGreaterThan(0);
      }
    }
  });

  it("a stylist reads their own durations, clients' habits and the salon's patterns, but no spend", async () => {
    const rows = await kinds(bridget);
    const durations = rows.filter((r) => r.kind === "duration");
    expect(durations.length).toBeGreaterThan(0);
    expect(durations.every((r) => r.key.startsWith(`${SEED.staff.bridget}:`))).toBe(true);
    expect(rows.some((r) => r.kind === "client_spend")).toBe(false);
    expect(rows.some((r) => r.kind === "client")).toBe(true);
    expect(rows.some((r) => r.kind === "salon")).toBe(true);
  });

  it("another salon reads nothing, and no one but the server writes", async () => {
    const other = await createOtherSalon();
    try {
      const outsider = await signIn(other.email);
      expect((await outsider.from("insights").select("key").eq("business_id", B)).data).toEqual([]);
    } finally {
      await other.cleanup();
    }
    const write = await owner.from("insights").insert({ business_id: B, kind: "salon", key: "fake", data: {} });
    expect(write.error?.code).toBe("42501");
    const change = await owner.from("insights").update({ data: {} }).eq("business_id", B).eq("kind", "salon").select("key");
    expect(change.data).toEqual([]);
  });
});

describe("after a checkout", () => {
  it("recalculates that client and the visit's stylists", async () => {
    const { data: visit } = await admin
      .from("appointments")
      .select("id, client_id, appointment_items(staff_id, service_id)")
      .eq("business_id", B)
      .eq("status", "completed")
      .not("client_id", "is", null)
      .order("starts_at", { ascending: false })
      .limit(1)
      .single();
    const before = new Date().toISOString();
    await recomputeForVisit(admin, visit!.id);
    const { data: client } = await admin.from("insights").select("computed_at").eq("kind", "client").eq("key", visit!.client_id!).single();
    expect(client!.computed_at >= before).toBe(true);
    const item = visit!.appointment_items[0];
    const { data: duration } = await admin.from("insights").select("computed_at").eq("kind", "duration").eq("key", `${item.staff_id}:${item.service_id}`).maybeSingle();
    if (duration) expect(duration.computed_at >= before).toBe(true);
  });
});
