// Packages in the database: owners set them up, the front desk sells and
// redeems them at checkout, managers cancel them with a pro-rated refund;
// levels, expiry, voids and who may do what.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { changeStatus, saveBooking } from "@/lib/scheduling/book";
import { fromLocal } from "@/lib/scheduling/time";
import { admin, SEED, signIn, type Client } from "./helpers";

const B = SEED.business;
const L = SEED.location;
const TZ = "America/Chicago";
const { bridget: BRIDGET, shae: SHAE } = SEED.staff;
// A Tuesday far from the seeded month. Bridget is a Master, Shae an Artisan.
const DAY = "2031-09-02";
const at = (hour: number, minute = 0) => fromLocal(DAY, hour * 60 + minute, TZ)!;
const PREFIX = `Pk${Date.now().toString(36)}`;

let owner: Client;
let manager: Client;
let frontDesk: Client;
let stylist: Client;
let clientId: string;
let otherClientId: string;
let blowout: { id: string; price: number };
let gloss: { id: string; price: number };
const templates: string[] = [];
const sales: string[] = [];

beforeAll(async () => {
  [owner, manager, frontDesk, stylist] = await Promise.all([
    signIn("owner@mapleandash.test"),
    signIn("manager@mapleandash.test"),
    signIn("frontdesk@mapleandash.test"),
    signIn("bridget@mapleandash.test"),
  ]);
  const { data: clients } = await admin.from("clients").insert([{ business_id: B, first_name: `${PREFIX}Ava`, last_name: "Test" }, { business_id: B, first_name: `${PREFIX}Bea`, last_name: "Test" }]).select("id");
  [clientId, otherClientId] = clients!.map((c) => c.id);
  const service = async (name: string) => {
    const { data } = await admin.from("services").select("id, price_cents").eq("business_id", B).eq("name", name).single();
    return { id: data!.id, price: data!.price_cents };
  };
  [blowout, gloss] = await Promise.all([service("Blowout"), service("Gloss / Toner")]);
  await admin.from("businesses").update({ tax_rate_services_bp: 0 }).eq("id", B);
});

afterAll(async () => {
  for (const id of sales) await admin.from("sales").delete().eq("id", id);
  await admin.from("client_packages").delete().in("client_id", [clientId, otherClientId]);
  await admin.from("appointments").delete().in("client_id", [clientId, otherClientId]);
  await admin.from("clients").delete().in("id", [clientId, otherClientId]);
  await admin.from("package_templates").delete().in("id", templates);
});

async function template(input: Record<string, unknown>) {
  const { data, error } = await owner.rpc("save_package_template", { p_template_id: null!, p_input: input as never });
  expect(error).toBeNull();
  templates.push(data!);
  return data!;
}

async function sell(client: Client, input: Record<string, unknown>) {
  const { data, error } = await client.rpc("complete_sale", { p_location_id: L, p_input: input as never });
  if (data) sales.push(data);
  return { data, error };
}

// A checked-in blowout for a client, with a stylist.
async function visit(who: string, staffId: string, hour: number) {
  const result = await saveBooking(frontDesk, { id: L, timezone: TZ }, { clientId: who, notes: null, items: [{ serviceId: blowout.id, staffId, start: at(hour), resource: { kind: "none" } }] });
  if (!result.ok) throw new Error(JSON.stringify(result));
  await changeStatus(frontDesk, result.appointmentId, "check_in");
  const { data: item } = await admin.from("appointment_items").select("id, price_cents").eq("appointment_id", result.appointmentId).single();
  return { appointmentId: result.appointmentId, itemId: item!.id, price: item!.price_cents };
}

const itemFor = async (packageId: string, serviceId: string) =>
  (await admin.from("client_package_items").select("id, total, used, use_value_cents").eq("client_package_id", packageId).eq("service_id", serviceId).single()).data!;

describe("setting up and selling packages", () => {
  it("only owners set them up; a sale gives the client their own copy, each use valued by menu prices", async () => {
    const denied = await frontDesk.rpc("save_package_template", { p_template_id: null!, p_input: { name: "Nope", price_cents: 1000, items: [{ service_id: blowout.id, quantity: 1 }] } as never });
    expect(denied.error?.code).toBe("42501");
    // Any level (levels: null, as the settings form sends it).
    const mix = await template({ name: `${PREFIX} 3 glosses + 3 blowouts`, price_cents: 30000, levels: null, items: [{ service_id: gloss.id, quantity: 3 }, { service_id: blowout.id, quantity: 3 }] });
    expect((await admin.from("package_templates").select("levels").eq("id", mix).single()).data!.levels).toBeNull();

    // Sold as retail-style, to the client; untaxed services here.
    const { data: saleId, error } = await sell(frontDesk, { client_id: clientId, lines: [{ kind: "package", template_id: mix }], payments: [{ method: "card", amount_cents: 30000 }] });
    expect(error).toBeNull();
    const { data: pkg } = await admin.from("client_packages").select("id, name, price_cents, status, sale_id, client_package_items(service_id, total, used, use_value_cents)").eq("sale_id", saleId!).single();
    expect(pkg).toMatchObject({ name: `${PREFIX} 3 glosses + 3 blowouts`, price_cents: 30000, status: "active" });
    // Uses add up to the price.
    expect(pkg!.client_package_items.reduce((n, i) => n + i.total * i.use_value_cents, 0)).toBe(30000);
    const line = (await admin.from("sale_items").select("kind, client_package_id").eq("sale_id", saleId!).single()).data!;
    expect(line).toEqual({ kind: "package", client_package_id: pkg!.id });

    // A package needs a client.
    expect((await sell(frontDesk, { lines: [{ kind: "package", template_id: mix }], payments: [{ method: "card", amount_cents: 30000 }] })).error?.message).toBe("Choose the client the package is for");
  });
});

describe("redeeming", () => {
  it("pays for a service with a use (recorded as a package payment), for the right client, level and count", async () => {
    const five = await template({ name: `${PREFIX} 2 blowouts`, price_cents: 8000, items: [{ service_id: blowout.id, quantity: 2 }] });
    const { data: saleId } = await sell(frontDesk, { client_id: clientId, lines: [{ kind: "package", template_id: five }], payments: [{ method: "cash", amount_cents: 8000 }] });
    const packageId = (await admin.from("client_packages").select("id").eq("sale_id", saleId!).single()).data!.id;
    const item = await itemFor(packageId, blowout.id);

    const v = await visit(clientId, BRIDGET, 10);
    // Nothing else to pay: the package covers the blowout.
    const { data: paid, error } = await sell(frontDesk, { appointment_id: v.appointmentId, lines: [{ kind: "service", appointment_item_id: v.itemId, package_item_id: item.id }], payments: [] });
    expect(error).toBeNull();
    expect((await itemFor(packageId, blowout.id)).used).toBe(1);
    const { data: payments } = await admin.from("payments").select("method, amount_cents, package_item_id").eq("sale_id", paid!);
    expect(payments).toEqual([{ method: "package", amount_cents: v.price, package_item_id: item.id }]);
    expect((await admin.from("sale_items").select("tax_cents, package_item_id").eq("sale_id", paid!).single()).data).toEqual({ tax_cents: 0, package_item_id: item.id });

    // Someone else can't use it.
    const theirs = await visit(otherClientId, BRIDGET, 12);
    expect((await sell(frontDesk, { appointment_id: theirs.appointmentId, lines: [{ kind: "service", appointment_item_id: theirs.itemId, package_item_id: item.id }], payments: [] })).error?.code).toBe("22023");

    // The last use, then none left.
    const second = await visit(clientId, BRIDGET, 14);
    expect((await sell(frontDesk, { appointment_id: second.appointmentId, lines: [{ kind: "service", appointment_item_id: second.itemId, package_item_id: item.id }], payments: [] })).error).toBeNull();
    const third = await visit(clientId, BRIDGET, 15);
    expect((await sell(frontDesk, { appointment_id: third.appointmentId, lines: [{ kind: "service", appointment_item_id: third.itemId, package_item_id: item.id }], payments: [] })).error?.message).toBe("No uses left on that package for this service");

    // Undo one by voiding its sale: the use comes back.
    expect((await manager.rpc("void_sale", { p_sale_id: paid!, p_reason: "Wrong client" })).error).toBeNull();
    expect((await itemFor(packageId, blowout.id)).used).toBe(1);
    const { data: events } = await admin.from("package_events").select("kind").eq("client_package_id", packageId).order("created_at");
    expect(events!.map((e) => e.kind)).toEqual(["sold", "used", "used", "restored"]);
  });

  it("only covers the stylist levels it's for, and not after it expires", async () => {
    const masters = await template({ name: `${PREFIX} Master blowouts`, price_cents: 9000, levels: ["master"], expiry_months: 6, items: [{ service_id: blowout.id, quantity: 2 }] });
    const { data: saleId } = await sell(frontDesk, { client_id: clientId, lines: [{ kind: "package", template_id: masters }], payments: [{ method: "card", amount_cents: 9000 }] });
    const pkg = (await admin.from("client_packages").select("id, expires_at").eq("sale_id", saleId!).single()).data!;
    expect(new Date(pkg.expires_at!).getTime()).toBeGreaterThan(Date.now() + 170 * 86_400_000);
    const item = await itemFor(pkg.id, blowout.id);

    const withShae = await visit(clientId, SHAE, 10);
    expect((await sell(frontDesk, { appointment_id: withShae.appointmentId, lines: [{ kind: "service", appointment_item_id: withShae.itemId, package_item_id: item.id }], payments: [] })).error?.message).toBe("That package doesn't cover this stylist's level");

    await admin.from("client_packages").update({ expires_at: new Date(Date.now() - 60_000).toISOString() }).eq("id", pkg.id);
    const withBridget = await visit(clientId, BRIDGET, 16);
    expect((await sell(frontDesk, { appointment_id: withBridget.appointmentId, lines: [{ kind: "service", appointment_item_id: withBridget.itemId, package_item_id: item.id }], payments: [] })).error?.message).toBe("That package has expired or was canceled");
  });
});

describe("canceling", () => {
  it("managers cancel with a reason and a pro-rated refund on the sale; the front desk can't", async () => {
    const three = await template({ name: `${PREFIX} 3 blowouts`, price_cents: 12000, items: [{ service_id: blowout.id, quantity: 3 }] });
    const { data: saleId } = await sell(frontDesk, { client_id: clientId, lines: [{ kind: "package", template_id: three }], payments: [{ method: "card", amount_cents: 12000 }] });
    const packageId = (await admin.from("client_packages").select("id").eq("sale_id", saleId!).single()).data!.id;
    const item = await itemFor(packageId, blowout.id);
    // One used.
    const v = await visit(clientId, BRIDGET, 11);
    await sell(frontDesk, { appointment_id: v.appointmentId, lines: [{ kind: "service", appointment_item_id: v.itemId, package_item_id: item.id }], payments: [] });

    expect((await frontDesk.rpc("cancel_package", { p_client_package_id: packageId, p_reason: "Moving away", p_refund_method: "card" })).error?.code).toBe("42501");
    expect((await manager.rpc("cancel_package", { p_client_package_id: packageId, p_reason: "", p_refund_method: "card" })).error?.code).toBe("22023");
    const { data: refunded, error } = await manager.rpc("cancel_package", { p_client_package_id: packageId, p_reason: "Moving away", p_refund_method: "card" });
    expect(error).toBeNull();
    // Two of three uses left at $40 each.
    expect(refunded).toBe(8000);
    expect((await admin.from("client_packages").select("status, refunded_cents, cancel_reason").eq("id", packageId).single()).data).toEqual({ status: "refunded", refunded_cents: 8000, cancel_reason: "Moving away" });
    expect((await admin.from("sales").select("status, refunded_cents").eq("id", saleId!).single()).data).toEqual({ status: "partly_refunded", refunded_cents: 8000 });
    expect((await admin.from("payments").select("method, amount_cents").eq("sale_id", saleId!).lt("amount_cents", 0).single()).data).toEqual({ method: "card", amount_cents: -8000 });
    expect((await manager.rpc("cancel_package", { p_client_package_id: packageId, p_reason: "Again", p_refund_method: "none" })).error?.code).toBe("55000");

    // A service paid by the package can't be refunded as money.
    const { data: covered } = await admin.from("sale_items").select("sale_id").eq("package_item_id", item.id).limit(1).single();
    expect((await manager.rpc("refund_sale", { p_sale_id: covered!.sale_id, p_input: { reason: "Unhappy", payments: [{ method: "cash", amount_cents: 1000 }] } as never })).error?.message).toBe(
      "Promotional credit, package uses and membership services can't be refunded as cash or card",
    );
  });

  it("everyone at the salon sees clients' packages; nobody changes them directly", async () => {
    const { data } = await stylist.from("client_packages").select("id").eq("client_id", clientId);
    expect(data!.length).toBeGreaterThan(0);
    expect((await stylist.from("client_package_items").update({ used: 0 }).eq("business_id", B).select()).data).toEqual([]);
    expect((await frontDesk.from("client_packages").update({ status: "active" }).eq("client_id", clientId).select()).data).toEqual([]);
  });
});
