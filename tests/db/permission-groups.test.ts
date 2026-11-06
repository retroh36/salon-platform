// Permission groups (migration …_permission_groups.sql): a group's switches
// apply to everyone in it, a person's own switch wins, a group never gives a
// role what it can't have, and only owners make groups or put people in them.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, SEED, signIn, type Client } from "./helpers";

const B = SEED.business;
let owner: Client;
let manager: Client;
let desk: Client;
let jordan: Client;
let gil: Client;
let group: string;

const perms = async (c: Client) => ((await c.rpc("my_permissions", { p_business_id: B })).data ?? []) as string[];

beforeAll(async () => {
  [owner, manager, desk, jordan, gil] = await Promise.all(
    ["owner", "manager", "frontdesk", "jordan", "gil"].map((n) => signIn(`${n}@mapleandash.test`)),
  );
  const { data, error } = await owner.rpc("save_permission_group", { p_business_id: B, p_id: null as unknown as string, p_name: "Senior front desk", p_permissions: { reports: true, void_refund: true, settings: true } });
  if (error) throw error;
  group = data;
});

afterAll(async () => {
  await admin.from("staff_permissions").delete().in("staff_id", [SEED.staff.frontDesk, SEED.staff.jordan, SEED.staff.gil]);
  await admin.from("permission_groups").delete().eq("business_id", B);
});

describe("permission groups", () => {
  it("give everyone in them the group's switches the role allows, until the group changes", async () => {
    for (const id of [SEED.staff.frontDesk, SEED.staff.jordan]) expect((await owner.rpc("set_staff_permission_group", { p_staff_id: id, p_group_id: group })).error).toBeNull();
    // Settings can't be given to the front desk, even by a group.
    expect(await perms(desk)).toEqual(["reports", "void_refund"]);
    expect(await perms(jordan)).toEqual(["reports", "void_refund"]);
    await owner.rpc("save_permission_group", { p_business_id: B, p_id: group, p_name: "Senior front desk", p_permissions: { reports: true } });
    expect(await perms(jordan)).toEqual(["reports"]);
  });

  it("let a person's own switch win over their group, and clear back to it", async () => {
    await owner.rpc("set_staff_permission", { p_staff_id: SEED.staff.frontDesk, p_permission: "reports", p_allowed: false });
    expect(await perms(desk)).toEqual([]);
    const { data: list } = await owner.rpc("staff_permission_list", { p_staff_id: SEED.staff.frontDesk });
    expect(list!.find((r) => r.permission === "reports")).toMatchObject({ allowed: false, inherited: true, own: true, role_default: false });
    // Switched to what the group already gives, it's no longer their own.
    await owner.rpc("set_staff_permission", { p_staff_id: SEED.staff.frontDesk, p_permission: "reports", p_allowed: true });
    expect((await admin.from("staff_permissions").select("permission").eq("staff_id", SEED.staff.frontDesk)).data).toEqual([]);
    expect(await perms(desk)).toEqual(["reports"]);
  });

  it("can turn a manager's default off", async () => {
    const { data: off } = await owner.rpc("save_permission_group", { p_business_id: B, p_id: null as unknown as string, p_name: "Manager, no payroll", p_permissions: { payroll: false } });
    await owner.rpc("set_staff_permission_group", { p_staff_id: SEED.staff.manager, p_group_id: off! });
    try {
      expect(await perms(manager)).not.toContain("payroll");
      expect(await perms(manager)).toContain("reports");
    } finally {
      await owner.rpc("set_staff_permission_group", { p_staff_id: SEED.staff.manager, p_group_id: null as unknown as string });
    }
    expect(await perms(manager)).toContain("payroll");
  });

  it("are made and given only by owners, never by editing the staff row", async () => {
    expect((await manager.rpc("save_permission_group", { p_business_id: B, p_id: null as unknown as string, p_name: "Mine", p_permissions: {} })).error?.code).toBe("42501");
    expect((await manager.rpc("set_staff_permission_group", { p_staff_id: SEED.staff.gil, p_group_id: group })).error?.code).toBe("42501");
    expect((await manager.from("staff").update({ permission_group_id: group }).eq("id", SEED.staff.gil)).error?.code).toBe("42501");
    expect((await owner.rpc("set_staff_permission_group", { p_staff_id: SEED.staff.owner, p_group_id: group })).error?.code).toBe("22023");
    expect((await owner.rpc("save_permission_group", { p_business_id: B, p_id: null as unknown as string, p_name: "senior FRONT desk ", p_permissions: {} })).error?.hint).toBe("name_taken");
    expect((await owner.rpc("save_permission_group", { p_business_id: B, p_id: null as unknown as string, p_name: "Odd", p_permissions: { billing: true } })).error?.code).toBe("22023");
  });

  it("are read by those who manage the team, and by each person for their own", async () => {
    expect((await manager.from("permission_groups").select("id")).data!.length).toBeGreaterThan(0);
    expect((await desk.from("permission_groups").select("id")).data!.map((g) => g.id)).toEqual([group]);
    expect((await gil.from("permission_groups").select("id")).data).toEqual([]);
  });

  it("removed, leave their people on their role's defaults", async () => {
    expect((await owner.rpc("delete_permission_group", { p_id: group })).error).toBeNull();
    expect(await perms(jordan)).toEqual([]);
    expect((await admin.from("staff").select("permission_group_id").eq("id", SEED.staff.jordan).single()).data!.permission_group_id).toBeNull();
  });
});
