// Services and staff_services: RLS, the save_service function and constraints.
// Run with `npm run test:db` after `npx supabase db reset`.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Json } from "@/lib/database.types";
import { admin, createOtherSalon, SEED, signIn, type Client } from "./helpers";

// Unique per run so test services never clash with seed data or each other.
const PREFIX = `Test ${crypto.randomUUID().slice(0, 8)}`;

let other: Awaited<ReturnType<typeof createOtherSalon>>;
let owner: Client;
let manager: Client;
let stylist: Client;
let otherOwner: Client;

type SaveArgs = {
  businessId?: string;
  serviceId?: string | null;
  name: string;
  active?: number;
  processing?: number;
  finishing?: number;
  price?: number;
  staff?: { staff_id: string; price_cents: number | null }[];
};

function save(client: Client, args: SaveArgs) {
  return client.rpc("save_service", {
    p_business_id: args.businessId ?? SEED.business,
    p_service_id: (args.serviceId ?? null) as string,
    p_name: args.name,
    p_category: "Test",
    p_description: "",
    p_active_minutes: args.active ?? 30,
    p_processing_minutes: args.processing ?? 0,
    p_finishing_minutes: args.finishing ?? 0,
    p_price_cents: args.price ?? 5000,
    p_staff: (args.staff ?? []) as Json,
  });
}

async function assignments(serviceId: string) {
  const { data, error } = await admin
    .from("staff_services")
    .select("staff_id, price_cents")
    .eq("service_id", serviceId)
    .order("staff_id");
  if (error) throw error;
  return data;
}

beforeAll(async () => {
  other = await createOtherSalon();
  [owner, manager, stylist, otherOwner] = await Promise.all([
    signIn("owner@mapleandash.test"),
    signIn("manager@mapleandash.test"),
    signIn("bridget@mapleandash.test"),
    signIn(other.email),
  ]);
});

afterAll(async () => {
  await admin.from("services").delete().like("name", `${PREFIX}%`);
  await other?.cleanup();
});

describe("seed data", () => {
  it("has a realistic menu with one archived service", async () => {
    const { data } = await admin.from("services").select("name, category, archived_at, duration_minutes").eq("business_id", SEED.business);
    const active = data!.filter((s) => !s.archived_at);
    expect(active.length).toBeGreaterThanOrEqual(35);
    expect(new Set(active.map((s) => s.category))).toEqual(
      new Set(["Cuts", "Color", "Highlights", "Balayage", "Blowouts & Styling", "Treatments"]),
    );
    expect(data!.filter((s) => s.archived_at).map((s) => s.name)).toEqual(["Perm"]);
  });

  it("assigns services to every seeded stylist", async () => {
    const { data } = await admin.from("staff_services").select("staff_id").eq("business_id", SEED.business);
    const stylists = new Set(data!.map((r) => r.staff_id));
    for (const id of [SEED.staff.bridget, SEED.staff.hannah, SEED.staff.nola, SEED.staff.shae]) {
      expect(stylists.has(id)).toBe(true);
    }
  });
});

describe("stylists", () => {
  it("can view services and who offers them", async () => {
    const services = await stylist.from("services").select("id");
    expect(services.data!.length).toBeGreaterThan(35);

    const offered = await stylist.from("staff_services").select("staff_id");
    expect(offered.data!.length).toBeGreaterThan(0);
  });

  it("can't add, edit or archive services", async () => {
    const created = await save(stylist, { name: `${PREFIX} by stylist` });
    expect(created.error?.code).toBe("42501");

    const { data: service } = await admin.from("services").select("id, price_cents").eq("business_id", SEED.business).eq("name", "Blowout").single();
    const edited = await save(stylist, { serviceId: service!.id, name: "Blowout", price: 1 });
    expect(edited.error?.code).toBe("42501");

    const archived = await stylist.from("services").update({ archived_at: new Date().toISOString() }).eq("id", service!.id).select();
    expect(archived.data).toEqual([]);

    const { data: after } = await admin.from("services").select("price_cents, archived_at").eq("id", service!.id).single();
    expect(after).toEqual({ price_cents: service!.price_cents, archived_at: null });
  });

  it("can't change who offers a service", async () => {
    const { data: service } = await admin.from("services").select("id").eq("business_id", SEED.business).eq("name", "Balayage").single();
    const insert = await stylist
      .from("staff_services")
      .insert({ business_id: SEED.business, staff_id: SEED.staff.nola, service_id: service!.id });
    expect(insert.error?.code).toBe("42501");

    const remove = await stylist.from("staff_services").delete().eq("service_id", service!.id).select();
    expect(remove.data).toEqual([]);
  });
});

describe("owners and managers", () => {
  it("add a service with stylists and custom prices", async () => {
    const { data: id, error } = await save(manager, {
      name: `${PREFIX} Glaze`,
      active: 15,
      processing: 20,
      finishing: 10,
      price: 6000,
      staff: [
        { staff_id: SEED.staff.bridget, price_cents: 7000 },
        { staff_id: SEED.staff.shae, price_cents: null },
      ],
    });
    expect(error).toBeNull();

    const { data: service } = await admin.from("services").select("duration_minutes, price_cents").eq("id", id!).single();
    expect(service).toEqual({ duration_minutes: 45, price_cents: 6000 });
    expect(await assignments(id!)).toEqual(
      [
        { staff_id: SEED.staff.bridget, price_cents: 7000 },
        { staff_id: SEED.staff.shae, price_cents: null },
      ].sort((a, b) => a.staff_id.localeCompare(b.staff_id)),
    );
  });

  it("edit a service and replace exactly who offers it", async () => {
    const { data: id } = await save(owner, {
      name: `${PREFIX} Trim`,
      staff: [
        { staff_id: SEED.staff.bridget, price_cents: null },
        { staff_id: SEED.staff.nola, price_cents: null },
      ],
    });

    const { error } = await save(owner, {
      serviceId: id!,
      name: `${PREFIX} Trim (renamed)`,
      price: 5500,
      staff: [
        { staff_id: SEED.staff.nola, price_cents: 4000 },
        { staff_id: SEED.staff.hannah, price_cents: null },
      ],
    });
    expect(error).toBeNull();

    const { data: service } = await admin.from("services").select("name, price_cents").eq("id", id!).single();
    expect(service).toEqual({ name: `${PREFIX} Trim (renamed)`, price_cents: 5500 });
    expect(await assignments(id!)).toEqual(
      [
        { staff_id: SEED.staff.nola, price_cents: 4000 },
        { staff_id: SEED.staff.hannah, price_cents: null },
      ].sort((a, b) => a.staff_id.localeCompare(b.staff_id)),
    );
  });

  it("an empty staff list removes everyone", async () => {
    const { data: id } = await save(owner, {
      name: `${PREFIX} Nobody`,
      staff: [{ staff_id: SEED.staff.bridget, price_cents: null }],
    });
    await save(owner, { serviceId: id!, name: `${PREFIX} Nobody`, staff: [] });
    expect(await assignments(id!)).toEqual([]);
  });

  it("archive and restore services", async () => {
    const { data: id } = await save(manager, { name: `${PREFIX} Seasonal` });
    const archived = await manager.from("services").update({ archived_at: new Date().toISOString() }).eq("id", id!).select("id");
    expect(archived.data).toHaveLength(1);

    const restored = await manager.from("services").update({ archived_at: null }).eq("id", id!).select("archived_at");
    expect(restored.data).toEqual([{ archived_at: null }]);
  });

  it("can't delete services, only archive them", async () => {
    const { data: id } = await save(owner, { name: `${PREFIX} Keep` });
    const removed = await owner.from("services").delete().eq("id", id!).select();
    expect(removed.data).toEqual([]);

    const { data } = await admin.from("services").select("id").eq("id", id!);
    expect(data).toHaveLength(1);
  });
});

describe("save_service is all-or-nothing", () => {
  it("creates nothing when a staff member doesn't exist", async () => {
    const name = `${PREFIX} Atomic`;
    const { error } = await save(owner, {
      name,
      staff: [
        { staff_id: SEED.staff.bridget, price_cents: null },
        { staff_id: crypto.randomUUID(), price_cents: null },
      ],
    });
    expect(error?.code).toBe("23503");

    const { data } = await admin.from("services").select("id").eq("business_id", SEED.business).eq("name", name);
    expect(data).toEqual([]);
  });

  it("keeps the old values when an edit fails", async () => {
    const { data: id } = await save(owner, {
      name: `${PREFIX} Stable`,
      price: 5000,
      staff: [{ staff_id: SEED.staff.bridget, price_cents: null }],
    });

    const { error } = await save(owner, {
      serviceId: id!,
      name: `${PREFIX} Stable`,
      price: 9900,
      staff: [{ staff_id: crypto.randomUUID(), price_cents: null }],
    });
    expect(error).not.toBeNull();

    const { data } = await admin.from("services").select("price_cents").eq("id", id!).single();
    expect(data!.price_cents).toBe(5000);
    expect(await assignments(id!)).toEqual([{ staff_id: SEED.staff.bridget, price_cents: null }]);
  });
});

describe("tenant isolation", () => {
  it("another salon sees none of this salon's services", async () => {
    const services = await otherOwner.from("services").select("id").eq("business_id", SEED.business);
    expect(services.data).toEqual([]);

    const offered = await otherOwner.from("staff_services").select("staff_id").eq("business_id", SEED.business);
    expect(offered.data).toEqual([]);
  });

  it("another salon can't add services to this salon", async () => {
    const { error } = await save(otherOwner, { name: `${PREFIX} Intruder` });
    expect(error?.code).toBe("42501");
  });

  it("another salon can't edit this salon's services", async () => {
    const { data: service } = await admin.from("services").select("id").eq("business_id", SEED.business).eq("name", "Blowout").single();
    const asOwnBusiness = await save(otherOwner, { businessId: other.businessId, serviceId: service!.id, name: "Hijacked" });
    expect(asOwnBusiness.error?.code).toBe("42501");

    const { data } = await admin.from("services").select("name").eq("id", service!.id).single();
    expect(data!.name).toBe("Blowout");
  });

  it("a salon can't assign another salon's staff to its services", async () => {
    const { error } = await save(otherOwner, {
      businessId: other.businessId,
      name: `${PREFIX} Poach`,
      staff: [{ staff_id: SEED.staff.bridget, price_cents: null }],
    });
    expect(error?.code).toBe("23503");

    const { data } = await admin.from("services").select("id").eq("business_id", other.businessId);
    expect(data).toEqual([]);
  });
});

describe("constraints", () => {
  it("rejects a second active service with the same name", async () => {
    const { error } = await save(owner, { name: "  blowout " });
    expect(error?.code).toBe("23505");
  });

  it("allows reusing the name of an archived service", async () => {
    const { data: id, error } = await save(owner, { name: "Perm" });
    expect(error).toBeNull();
    await admin.from("services").delete().eq("id", id!);
  });

  it("rejects finishing time without a processing gap", async () => {
    const { error } = await save(owner, { name: `${PREFIX} Bad time`, processing: 0, finishing: 15 });
    expect(error?.code).toBe("23514");
  });

  it("rejects times that aren't 5-minute steps", async () => {
    const { error } = await save(owner, { name: `${PREFIX} Odd`, active: 32 });
    expect(error?.code).toBe("23514");
  });

  it("rejects negative prices", async () => {
    const { error } = await save(owner, { name: `${PREFIX} Negative`, price: -100 });
    expect(error?.code).toBe("23514");
  });
});

describe("prices by level", () => {
  it("are seeded: Artisans charge less, Masters more, and a stylist's own price wins", async () => {
    const { data: cut } = await admin.from("services").select("id, price_cents, service_level_prices(level, price_cents)").eq("business_id", SEED.business).eq("name", "Women's Cut & Style").single();
    const byLevel = Object.fromEntries(cut!.service_level_prices.map((p) => [p.level, p.price_cents]));
    expect(byLevel).toEqual({ artisan: 7000, senior: 8500, master: 10000 });
    const { data: fade } = await admin.from("services").select("id").eq("business_id", SEED.business).eq("name", "Skin Fade").single();
    const { data: custom } = await admin.from("staff_services").select("price_cents").eq("staff_id", SEED.staff.gil).eq("service_id", fade!.id).single();
    expect(custom!.price_cents).toBe(5500);
  });

  it("owners and managers set them; a blank level uses the menu price", async () => {
    const { data: id } = await save(manager, { name: `${PREFIX} Level priced`, price: 5000, staff: [{ staff_id: SEED.staff.shae, price_cents: null }] });
    const prices = async () => {
      const { data } = await admin.from("service_level_prices").select("level, price_cents").eq("service_id", id!).order("level");
      return data;
    };
    expect((await manager.rpc("set_service_level_prices", { p_service_id: id!, p_prices: { artisan: 4000, senior: null, master: 6500 } })).error).toBeNull();
    expect(await prices()).toEqual([
      { level: "artisan", price_cents: 4000 },
      { level: "master", price_cents: 6500 },
    ]);
    // Replaces them all.
    await manager.rpc("set_service_level_prices", { p_service_id: id!, p_prices: { master: 7000 } });
    expect(await prices()).toEqual([{ level: "master", price_cents: 7000 }]);

    // Stylists and other salons can't.
    await stylist.rpc("set_service_level_prices", { p_service_id: id!, p_prices: { master: 1 } });
    await otherOwner.rpc("set_service_level_prices", { p_service_id: id!, p_prices: { master: 1 } });
    expect(await prices()).toEqual([{ level: "master", price_cents: 7000 }]);
    expect((await otherOwner.from("service_level_prices").select("service_id").eq("service_id", id!)).data).toEqual([]);
  });
});
