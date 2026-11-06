// Working roles (Settings → Working roles): set up with `settings`, paid as
// set by `payroll`, worked by whoever the team's managers choose; the pay is
// read only by payroll and the people who work the role, and nothing is
// seen by another salon.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, type Client, createOtherSalon, SEED, signIn } from "./helpers";

const B = SEED.business;
let owner: Client;
let manager: Client;
let frontDesk: Client;
let bridget: Client;
let gil: Client;
let other: Awaited<ReturnType<typeof createOtherSalon>>;
let otherOwner: Client;
let blowout: string;
const made: string[] = [];

const addRole = async (as: Client, name: string, services: string[] = []) => {
  const r = await as.rpc("save_working_role", { p_business_id: B, p_role_id: null!, p_name: name, p_online: true, p_service_ids: services });
  if (r.data) made.push(r.data);
  return r;
};

beforeAll(async () => {
  [owner, manager, frontDesk, bridget, gil] = await Promise.all(
    ["owner@mapleandash.test", "manager@mapleandash.test", "frontdesk@mapleandash.test", "bridget@mapleandash.test", "gil@mapleandash.test"].map(signIn),
  );
  other = await createOtherSalon();
  otherOwner = await signIn(other.email);
  blowout = (await admin.from("services").select("id").eq("business_id", B).eq("name", "Blowout").single()).data!.id;
});

afterAll(async () => {
  await admin.from("working_roles").delete().in("id", made);
  await other.cleanup();
});

describe("working roles", () => {
  it("are set up by those with settings, and refused for anyone else", async () => {
    const r = await addRole(manager, "Wash House Test", [blowout]);
    expect(r.error).toBeNull();
    const { data: services } = await admin.from("working_role_services").select("service_id").eq("role_id", r.data!);
    expect(services).toEqual([{ service_id: blowout }]);
    // Every new role starts paid as the person usually is.
    expect((await admin.from("working_role_pay").select("method").eq("role_id", r.data!).single()).data).toEqual({ method: "usual" });

    expect((await addRole(frontDesk, "Not Allowed")).error?.code).toBe("42501");
    expect((await addRole(bridget, "Not Allowed")).error?.code).toBe("42501");
  });

  it("can't share a name with another role in use", async () => {
    await addRole(owner, "Beauty Bar Test");
    expect((await addRole(owner, " beauty bar test ")).error?.code).toBe("23505");
  });

  it("only take the salon's own services", async () => {
    const { data: foreign } = await admin.from("services").insert({ business_id: other.businessId, name: "Elsewhere", category: "Cut", active_minutes: 30, price_cents: 1000 }).select("id").single();
    expect((await addRole(owner, "Foreign Test", [foreign!.id])).error?.code).toBe("22023");
  });

  it("are paid as payroll sets, and refused without it", async () => {
    const id = (await addRole(owner, "Hourly Test")).data!;
    expect((await manager.rpc("save_working_role_pay", { p_role_id: id, p_method: "hourly", p_hourly_rate_cents: 1800, p_commission_pct: null! })).error).toBeNull();
    expect((await manager.rpc("save_working_role_pay", { p_role_id: id, p_method: "hourly", p_hourly_rate_cents: null!, p_commission_pct: null! })).error?.hint).toBe("rate");
    expect((await frontDesk.rpc("save_working_role_pay", { p_role_id: id, p_method: "usual", p_hourly_rate_cents: null!, p_commission_pct: null! })).error?.code).toBe("42501");
  });

  it("are given to people by those who manage the team, and their pay is read by payroll and the people in them", async () => {
    const id = (await addRole(owner, "Pay Read Test")).data!;
    await owner.rpc("save_working_role_pay", { p_role_id: id, p_method: "commission", p_hourly_rate_cents: null!, p_commission_pct: 35 });
    expect((await frontDesk.rpc("set_staff_working_roles", { p_staff_id: SEED.staff.bridget, p_role_ids: [id] })).error?.code).toBe("42501");
    expect((await manager.rpc("set_staff_working_roles", { p_staff_id: SEED.staff.bridget, p_role_ids: [id] })).error).toBeNull();

    // Everyone at the salon sees the role and who works it.
    expect((await frontDesk.from("working_roles").select("id").eq("id", id)).data).toHaveLength(1);
    expect((await gil.from("staff_working_roles").select("staff_id").eq("role_id", id)).data).toEqual([{ staff_id: SEED.staff.bridget }]);
    // Its pay: payroll and Bridget, who works it; not Gil or the front desk.
    expect((await manager.from("working_role_pay").select("commission_pct").eq("role_id", id)).data).toEqual([{ commission_pct: 35 }]);
    expect((await bridget.from("working_role_pay").select("commission_pct").eq("role_id", id)).data).toEqual([{ commission_pct: 35 }]);
    expect((await gil.from("working_role_pay").select("role_id").eq("role_id", id)).data).toEqual([]);
    expect((await frontDesk.from("working_role_pay").select("role_id").eq("role_id", id)).data).toEqual([]);

    // Her own rate in it: set by payroll, read by her and payroll only.
    expect((await manager.rpc("set_staff_role_pay", { p_staff_id: SEED.staff.bridget, p_role_id: id, p_hourly_rate_cents: null!, p_commission_pct: 40 })).error).toBeNull();
    expect((await bridget.from("staff_role_pay").select("commission_pct").eq("role_id", id)).data).toEqual([{ commission_pct: 40 }]);
    expect((await gil.from("staff_role_pay").select("role_id").eq("role_id", id)).data).toEqual([]);
    expect((await manager.rpc("set_staff_role_pay", { p_staff_id: SEED.staff.gil, p_role_id: id, p_hourly_rate_cents: 2000, p_commission_pct: null! })).error?.hint).toBe("not_their_role");

    // Taking her off the role takes her own rate with it.
    await manager.rpc("set_staff_working_roles", { p_staff_id: SEED.staff.bridget, p_role_ids: [] });
    expect((await admin.from("staff_role_pay").select("role_id").eq("role_id", id)).data).toEqual([]);
  });

  it("a manager can't change an owner's roles", async () => {
    const id = (await addRole(owner, "Owner Test")).data!;
    expect((await manager.rpc("set_staff_working_roles", { p_staff_id: SEED.staff.owner, p_role_ids: [id] })).error?.code).toBe("42501");
  });

  it("an archived role can't be given to anyone", async () => {
    const id = (await addRole(owner, "Archive Test")).data!;
    await owner.rpc("save_working_role", { p_business_id: B, p_role_id: id, p_name: "Archive Test", p_online: true, p_service_ids: [], p_archive: true });
    expect((await manager.rpc("set_staff_working_roles", { p_staff_id: SEED.staff.gil, p_role_ids: [id] })).error?.code).toBe("22023");
    // Its name is free again.
    expect((await addRole(owner, "Archive Test")).error).toBeNull();
  });

  it("are never seen or changed by another salon", async () => {
    const id = (await addRole(owner, "Private Test")).data!;
    for (const table of ["working_roles", "working_role_services", "staff_working_roles", "working_role_pay", "staff_role_pay"] as const) {
      expect((await otherOwner.from(table).select("business_id").eq("business_id", B)).data).toEqual([]);
    }
    expect((await otherOwner.rpc("save_working_role", { p_business_id: B, p_role_id: id, p_name: "Taken", p_online: false, p_service_ids: [] })).error?.code).toBe("42501");
    expect((await otherOwner.rpc("save_working_role_pay", { p_role_id: id, p_method: "usual", p_hourly_rate_cents: null!, p_commission_pct: null! })).error?.code).toBe("42501");
    expect((await otherOwner.rpc("set_staff_working_roles", { p_staff_id: SEED.staff.gil, p_role_ids: [] })).error?.code).toBe("42501");
  });
});
