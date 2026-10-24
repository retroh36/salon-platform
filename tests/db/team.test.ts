// Managing the team: adding and editing people (role, level, services,
// hours), who may do it, keeping an owner, deactivating, and who can see
// logins. Run with `npm run test:db` after `npm run seed:demo`.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, createOtherSalon, SEED, signIn, type Client } from "./helpers";

const B = SEED.business;
const L = SEED.location;
const TAG = `Tm${Date.now().toString(36)}`;

let owner: Client, manager: Client, frontDesk: Client, bridget: Client, otherOwner: Client;
let services: string[];

const input = (extra: Record<string, unknown> = {}) => ({ first_name: `${TAG}Rae`, last_name: "Test", email: null, phone: null, role: "stylist", level: "senior", service_ids: services.slice(0, 2), ...extra });
const add = (as: Client, extra: Record<string, unknown> = {}) => as.rpc("save_team_member", { p_business_id: B, p_location_id: L, p_staff_id: null!, p_input: input(extra) as never });

beforeAll(async () => {
  [owner, manager, frontDesk, bridget] = await Promise.all(["owner", "manager", "frontdesk", "bridget"].map((n) => signIn(`${n}@mapleandash.test`)));
  otherOwner = await signIn((await createOtherSalon()).email);
  const { data } = await admin.from("services").select("id").eq("business_id", B).is("archived_at", null).order("name").limit(3);
  services = data!.map((s) => s.id);
});

afterAll(async () => {
  await admin.from("staff").delete().like("first_name", `${TAG}%`);
  await admin.from("staff").update({ role: "owner", is_active: true }).eq("id", SEED.staff.owner);
});

describe("adding someone", () => {
  it("saves who they are, their services and hours, in one go", async () => {
    const { data: id, error } = await add(owner, { hours: [{ weekday: 2, start_minute: 540, end_minute: 1020 }] });
    expect(error).toBeNull();
    const { data: s } = await admin.from("staff").select("role, level, location_id, is_active, staff_services(service_id), staff_working_hours(weekday, start_minute, end_minute)").eq("id", id!).single();
    expect(s).toMatchObject({ role: "stylist", level: "senior", location_id: L, is_active: true, staff_working_hours: [{ weekday: 2, start_minute: 540, end_minute: 1020 }] });
    expect(s!.staff_services.map((x) => x.service_id).sort()).toEqual(services.slice(0, 2).sort());
  });

  it("is for owners and managers, and only owners make owners", async () => {
    expect((await add(manager)).error).toBeNull();
    expect((await add(manager, { role: "owner" })).error?.code).toBe("42501");
    expect((await add(frontDesk)).error?.code).toBe("42501");
    expect((await add(bridget)).error?.code).toBe("42501");
    expect((await otherOwner.rpc("save_team_member", { p_business_id: B, p_location_id: L, p_staff_id: null!, p_input: input() as never })).error?.code).toBe("42501");
  });
});

describe("changing someone", () => {
  it("sets exactly their services, keeping a stylist's own price for ones they still do", async () => {
    const { data: id } = await add(owner);
    await admin.from("staff_services").update({ price_cents: 9900 }).eq("staff_id", id!).eq("service_id", services[0]);
    const { error } = await owner.rpc("save_team_member", { p_business_id: B, p_location_id: L, p_staff_id: id!, p_input: input({ service_ids: [services[0], services[2]], role: "front_desk" }) as never });
    expect(error).toBeNull();
    const { data } = await admin.from("staff_services").select("service_id, price_cents").eq("staff_id", id!).order("service_id");
    expect(data).toEqual([{ service_id: services[0], price_cents: 9900 }, { service_id: services[2], price_cents: null }].sort((a, b) => a.service_id.localeCompare(b.service_id)));
    // Not a stylist any more: no level.
    expect((await admin.from("staff").select("role, level").eq("id", id!).single()).data).toEqual({ role: "front_desk", level: "senior" });
  });

  it("managers can't change owners; nobody changes their own role; the salon keeps an owner", async () => {
    const save = (as: Client, id: string, role: string, first = "Owner") => as.rpc("save_team_member", { p_business_id: B, p_location_id: L, p_staff_id: id, p_input: input({ first_name: first, last_name: "", role, service_ids: [] }) as never });
    expect((await save(manager, SEED.staff.owner, "owner")).error?.code).toBe("42501");
    expect((await save(manager, SEED.staff.manager, "stylist", "Manager")).error?.code).toBe("55000");
    expect((await save(owner, SEED.staff.owner, "manager")).error?.code).toBe("55000");
    expect((await admin.from("staff").select("role").eq("id", SEED.staff.owner).single()).data!.role).toBe("owner");
  });
});

describe("someone leaving", () => {
  it("is deactivated, not deleted, and can come back", async () => {
    const { data: id } = await add(manager);
    expect((await manager.rpc("set_staff_active", { p_staff_id: id!, p_active: false })).error).toBeNull();
    expect((await admin.from("staff").select("is_active").eq("id", id!).single()).data!.is_active).toBe(false);
    expect((await manager.rpc("set_staff_active", { p_staff_id: id!, p_active: true })).error).toBeNull();
    expect((await bridget.rpc("set_staff_active", { p_staff_id: id!, p_active: false })).error?.code).toBe("42501");
  });

  it("never yourself, an owner by a manager, or the last owner", async () => {
    expect((await manager.rpc("set_staff_active", { p_staff_id: SEED.staff.manager, p_active: false })).error?.code).toBe("55000");
    expect((await manager.rpc("set_staff_active", { p_staff_id: SEED.staff.owner, p_active: false })).error?.code).toBe("42501");
    // Another owner deactivating the only other owner.
    const { data: second } = await add(owner, { role: "owner", level: null });
    const secondOwner = second!;
    expect((await owner.rpc("set_staff_active", { p_staff_id: secondOwner, p_active: false })).error).toBeNull();
    await admin.from("staff").update({ is_active: false }).eq("id", secondOwner);
    expect((await owner.rpc("set_staff_active", { p_staff_id: SEED.staff.owner, p_active: false })).error?.code).toBe("55000");
  });
});

describe("logins", () => {
  it("owners and managers see whose login is set up; nobody else does", async () => {
    const { data } = await owner.rpc("team_logins", { p_business_id: B });
    expect(data!.find((l) => l.staff_id === SEED.staff.bridget)).toMatchObject({ email: "bridget@mapleandash.test" });
    expect((await manager.rpc("team_logins", { p_business_id: B })).data!.length).toBe(data!.length);
    expect((await bridget.rpc("team_logins", { p_business_id: B })).data).toEqual([]);
    expect((await frontDesk.rpc("team_logins", { p_business_id: B })).data).toEqual([]);
    expect((await otherOwner.rpc("team_logins", { p_business_id: B })).data).toEqual([]);
  });

  it("a staff record's login can't be set from the app", async () => {
    const { data: id } = await add(owner);
    const { data: u } = await admin.auth.admin.listUsers({ perPage: 1 });
    // RLS lets owners update the row, so the column itself is locked down.
    const { error } = await owner.from("staff").update({ user_id: u.users[0].id }).eq("id", id!);
    expect(error?.code).toBe("42501");
    expect((await owner.from("staff").insert({ business_id: B, location_id: L, first_name: `${TAG}Sneak`, user_id: u.users[0].id })).error?.code).toBe("42501");
    expect((await admin.from("staff").select("user_id").eq("id", id!).single()).data!.user_id).toBeNull();
  });
});
