// Formulas with products, service recipes, and taking them from stock when
// a visit is checked out. Run with `npm run test:db` after `npx supabase db reset`.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { changeStatus, saveBooking, type BookingItemInput } from "@/lib/scheduling/book";
import { fromLocal } from "@/lib/scheduling/time";
import { admin, createOtherSalon, SEED, signIn, type Client } from "./helpers";

const B = SEED.business;
const L = SEED.location;
const TZ = "America/Chicago";
const location = { id: L, timezone: TZ };
const { priya: PRIYA, ethan: ETHAN } = SEED.staff;
// A Tuesday far from the seeded month.
const DAY = "2031-07-01";
const at = (hour: number, minute = 0) => fromLocal(DAY, hour * 60 + minute, TZ)!;
const TODAY = new Date().toISOString().slice(0, 10);

let other: Awaited<ReturnType<typeof createOtherSalon>>;
let frontDesk: Client;
let manager: Client;
let priya: Client;
let marcus: Client;
let otherOwner: Client;
let services: Map<string, string>;
let sku: Map<string, string>;
let clientId: string;
const appointments: string[] = [];

function item(service: string, staffId: string, start: Date): BookingItemInput {
  return { serviceId: services.get(service)!, staffId, start, resource: { kind: "none" } };
}

async function book(items: BookingItemInput[]) {
  const result = await saveBooking(frontDesk, location, { clientId, notes: null, items });
  if (!result.ok) throw new Error(JSON.stringify(result));
  appointments.push(result.appointmentId);
  const { data } = await admin.from("appointment_items").select("id").eq("appointment_id", result.appointmentId).order("starts_at");
  return { appointmentId: result.appointmentId, itemIds: data!.map((i) => i.id) };
}

async function checkOut(appointmentId: string) {
  expect(await changeStatus(frontDesk, appointmentId, "check_in")).toEqual({ ok: true });
  expect(await changeStatus(frontDesk, appointmentId, "check_out")).toEqual({ ok: true });
}

// What's been taken from stock for a service, by SKU.
async function used(itemId: string) {
  const { data } = await admin.from("stock_movements").select("change, reason, note, product:products(sku)").eq("appointment_item_id", itemId);
  const totals: Record<string, number> = {};
  for (const m of data!) {
    expect(m.reason).toBe("service_use");
    totals[m.product.sku!] = Math.round(((totals[m.product.sku!] ?? 0) - m.change) * 100) / 100;
  }
  for (const k of Object.keys(totals)) if (totals[k] === 0) delete totals[k];
  return totals;
}

async function onHand(code: string) {
  const { data } = await admin.from("stock_levels").select("on_hand").eq("product_id", sku.get(code)!).eq("location_id", L).single();
  return data!.on_hand;
}

const formula = (client: Client, itemId: string | null, lines: [string, number][], text = "Test formula") =>
  client.rpc("add_formula", {
    p_client_id: clientId,
    p_appointment_item_id: itemId!,
    p_visit_date: TODAY,
    p_formula: text,
    p_notes: "",
    p_lines: lines.map(([code, amount]) => ({ product_id: sku.get(code)!, amount })),
  });

beforeAll(async () => {
  other = await createOtherSalon();
  [frontDesk, manager, priya, marcus, otherOwner] = await Promise.all([
    signIn("frontdesk@mapleandash.test"),
    signIn("manager@mapleandash.test"),
    signIn("priya@mapleandash.test"),
    signIn("marcus@mapleandash.test"),
    signIn(other.email),
  ]);
  const [{ data: s }, { data: p }, { data: c }] = await Promise.all([
    admin.from("services").select("id, name").eq("business_id", B),
    admin.from("products").select("id, sku").eq("business_id", B),
    admin.from("clients").select("id").eq("business_id", B).order("id").limit(1).single(),
  ]);
  services = new Map(s!.map((x) => [x.name, x.id]));
  sku = new Map(p!.filter((x) => x.sku).map((x) => [x.sku!, x.id]));
  clientId = c!.id;
});

afterEach(async () => {
  if (appointments.length) {
    // Put back what the tests took, then remove their visits.
    const { data: moves } = await admin.from("stock_movements").select("id, product_id, change").in("appointment_id", appointments);
    for (const m of moves ?? []) {
      const { data: level } = await admin.from("stock_levels").select("on_hand").eq("product_id", m.product_id).eq("location_id", L).single();
      await admin.from("stock_levels").update({ on_hand: level!.on_hand - m.change }).eq("product_id", m.product_id).eq("location_id", L);
    }
    await admin.from("stock_movements").delete().in("appointment_id", appointments);
    await admin.from("client_formulas").delete().eq("client_id", clientId).eq("formula", "Test formula");
    await admin.from("appointments").delete().in("id", appointments.splice(0));
  }
});

afterAll(async () => {
  await other?.cleanup();
});

describe("checking out", () => {
  it("takes a service's recipe from stock when there's no formula", async () => {
    const before = await onHand("RK-EQ-09V");
    const visit = await book([item("Gloss / Toner", PRIYA, at(10))]);
    await changeStatus(frontDesk, visit.appointmentId, "check_in");
    expect(await used(visit.itemIds[0])).toEqual({}); // nothing until checkout
    await changeStatus(frontDesk, visit.appointmentId, "check_out");

    expect(await used(visit.itemIds[0])).toEqual({ "RK-EQ-09V": 60, "RK-EQ-PS": 60 });
    expect(await onHand("RK-EQ-09V")).toBeCloseTo(before - 60, 2);
    const { data } = await admin.from("stock_movements").select("note, appointment_id, created_by").eq("appointment_item_id", visit.itemIds[0]).limit(1).single();
    expect(data).toEqual({ note: "Gloss / Toner: recipe", appointment_id: visit.appointmentId, created_by: SEED.staff.frontDesk });
  });

  it("uses exactly the formula's products and amounts instead, partly used tubes included", async () => {
    const before = { tc: await onHand("GW-TC-7N"), dev: await onHand("GW-DEV-20") };
    const visit = await book([item("All-Over Color", PRIYA, at(10))]);
    // Priya records it as herself, before checkout.
    const { error } = await formula(priya, visit.itemIds[0], [["GW-TC-7N", 22.5], ["GW-DEV-20", 30]]);
    expect(error).toBeNull();
    expect(await used(visit.itemIds[0])).toEqual({});
    await checkOut(visit.appointmentId);

    expect(await used(visit.itemIds[0])).toEqual({ "GW-TC-7N": 22.5, "GW-DEV-20": 30 });
    expect(await onHand("GW-TC-7N")).toBeCloseTo(before.tc - 22.5, 2);
    expect(await onHand("GW-DEV-20")).toBeCloseTo(before.dev - 30, 2);
  });

  it("puts stock right when the formula is recorded or corrected after checkout", async () => {
    const before = { six: await onHand("GW-TC-6N"), seven: await onHand("GW-TC-7N"), dev: await onHand("GW-DEV-20") };
    const visit = await book([item("All-Over Color", PRIYA, at(10))]);
    await checkOut(visit.appointmentId);
    expect(await used(visit.itemIds[0])).toEqual({ "GW-TC-6N": 60, "GW-DEV-20": 60 }); // the recipe

    await formula(priya, visit.itemIds[0], [["GW-TC-7N", 30], ["GW-DEV-20", 30]]);
    expect(await used(visit.itemIds[0])).toEqual({ "GW-TC-7N": 30, "GW-DEV-20": 30 });
    // A correction replaces it.
    await formula(priya, visit.itemIds[0], [["GW-TC-7N", 45], ["GW-DEV-20", 45]]);
    expect(await used(visit.itemIds[0])).toEqual({ "GW-TC-7N": 45, "GW-DEV-20": 45 });
    expect(await onHand("GW-TC-6N")).toBeCloseTo(before.six, 2);
    expect(await onHand("GW-TC-7N")).toBeCloseTo(before.seven - 45, 2);
    expect(await onHand("GW-DEV-20")).toBeCloseTo(before.dev - 45, 2);

    // Each change is a logged movement.
    const { data } = await admin.from("stock_movements").select("note").eq("appointment_item_id", visit.itemIds[0]).order("created_at");
    expect(data!.map((m) => m.note)).toContain("All-Over Color: correction");
  });

  it("handles each service of a multi-service visit on its own", async () => {
    const visit = await book([item("Gloss / Toner", PRIYA, at(10)), item("Women's Cut & Style", ETHAN, at(11))]);
    await formula(priya, visit.itemIds[0], [["RK-EQ-08GI", 45], ["RK-EQ-PS", 45]]);
    await checkOut(visit.appointmentId);
    expect(await used(visit.itemIds[0])).toEqual({ "RK-EQ-08GI": 45, "RK-EQ-PS": 45 });
    expect(await used(visit.itemIds[1])).toEqual({ "RK-AS-SH-1L": 15, "RK-AS-CO-1L": 15 });
  });

  it("takes nothing for canceled visits or no-shows", async () => {
    const canceled = await book([item("Gloss / Toner", PRIYA, at(10))]);
    await formula(priya, canceled.itemIds[0], [["RK-EQ-09V", 30]]);
    expect(await changeStatus(frontDesk, canceled.appointmentId, "cancel", "Client canceled")).toEqual({ ok: true });
    const noShow = await book([item("Gloss / Toner", PRIYA, at(12))]);
    expect(await changeStatus(frontDesk, noShow.appointmentId, "no_show")).toEqual({ ok: true });
    expect(await used(canceled.itemIds[0])).toEqual({});
    expect(await used(noShow.itemIds[0])).toEqual({});
  });
});

describe("recording formulas", () => {
  it("records who wrote it, linked to the service, with the products in order", async () => {
    const visit = await book([item("All-Over Color", PRIYA, at(10))]);
    const { data: id } = await formula(priya, visit.itemIds[0], [["GW-TC-7N", 30], ["GW-DEV-20", 30]]);
    const { data } = await admin.from("client_formulas").select("staff_id, appointment_item_id, formula_products(amount, position, product_id)").eq("id", id!).single();
    expect(data!.staff_id).toBe(PRIYA);
    expect(data!.appointment_item_id).toBe(visit.itemIds[0]);
    expect(data!.formula_products.sort((a, b) => a.position - b.position).map((l) => [l.product_id, l.amount])).toEqual([
      [sku.get("GW-TC-7N"), 30],
      [sku.get("GW-DEV-20"), 30],
    ]);
  });

  it("refuses retail products, another client's visit, and other salons", async () => {
    const visit = await book([item("All-Over Color", PRIYA, at(10))]);
    expect((await formula(priya, visit.itemIds[0], [["OLX-3-100", 1]])).error?.code).toBe("22023");
    const { data: c } = await admin.from("clients").select("id").eq("business_id", B).neq("id", clientId).limit(1).single();
    const wrongClient = await priya.rpc("add_formula", { p_client_id: c!.id, p_appointment_item_id: visit.itemIds[0], p_visit_date: TODAY, p_formula: "x", p_notes: "", p_lines: [] });
    expect(wrongClient.error?.code).toBe("22023");
    expect((await formula(otherOwner, visit.itemIds[0], [["GW-TC-7N", 30]])).error?.code).toBe("42501");
    // Formula products are written with their formula only.
    const { data: f } = await formula(marcus, null, [], "Test formula");
    const direct = await priya.from("formula_products").insert({ business_id: B, formula_id: f!, product_id: sku.get("GW-TC-7N")!, amount: 1 });
    expect(direct.error?.code).toBe("42501");
  });
});

describe("recipes", () => {
  it("are seeded for color services, e.g. a gloss uses 60 + 60", async () => {
    const { data } = await admin.from("service_products").select("amount, product:products(sku)").eq("service_id", services.get("Gloss / Toner")!);
    expect(data!.map((r) => [r.product.sku, r.amount]).sort()).toEqual([
      ["RK-EQ-09V", 60],
      ["RK-EQ-PS", 60],
    ]);
  });

  it("are set by owners and managers only, with back-bar products", async () => {
    const service = services.get("Face-Frame Highlights")!;
    const { data: before } = await admin.from("service_products").select("product_id, amount").eq("service_id", service);
    const set = (client: Client, lines: [string, number][]) =>
      client.rpc("set_service_recipe", { p_service_id: service, p_lines: lines.map(([code, amount]) => ({ product_id: sku.get(code)!, amount })) });

    expect((await set(priya, [["WE-BLD-800", 25]])).error?.code).toBe("42501");
    expect((await set(frontDesk, [["WE-BLD-800", 25]])).error?.code).toBe("42501");
    expect((await set(manager, [["OLX-3-100", 1]])).error?.code).toBe("22023");
    expect((await set(manager, [["WE-BLD-800", 25], ["GW-DEV-20", 50]])).error).toBeNull();
    const { data: after } = await admin.from("service_products").select("amount, product:products(sku)").eq("service_id", service);
    expect(after!.map((r) => [r.product.sku, r.amount]).sort()).toEqual([
      ["GW-DEV-20", 50],
      ["WE-BLD-800", 25],
    ]);
    // Put it back.
    await admin.from("service_products").delete().eq("service_id", service);
    await admin.from("service_products").insert(before!.map((r) => ({ business_id: B, service_id: service, ...r })));
  });
});
