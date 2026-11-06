// Tasks Denise prepares for someone to confirm (lib/denise/tasks-load.ts,
// apply_task_action / undo_task_action): nothing changes until Confirm,
// Confirm only while the times are as prepared, Undo only while they're as
// confirmed, and only for someone who may change that person's times.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prepareTask } from "@/lib/denise/tasks-load";
import { admin, type Client, SEED, signIn, throwawayStylist } from "./helpers";

const B = SEED.business;
const MANAGER = { role: "manager" as const, permissions: ["team"], locationId: SEED.location };
let stylist: Awaited<ReturnType<typeof throwawayStylist>>;
let source: Awaited<ReturnType<typeof throwawayStylist>>;
let manager: Client;
let frontDesk: Client;
let cut: string;
let color: string;

const own = async (staffId = stylist.id) =>
  Object.fromEntries(((await admin.from("staff_services").select("service_id, active_minutes, processing_minutes, finishing_minutes").eq("staff_id", staffId)).data ?? []).map((r) => [r.service_id, r.active_minutes === null ? null : [r.active_minutes, r.processing_minutes, r.finishing_minutes]]));
const setOwn = (serviceId: string, t: [number, number, number] | null) =>
  admin.from("staff_services").update({ active_minutes: t?.[0] ?? null, processing_minutes: t?.[1] ?? null, finishing_minutes: t?.[2] ?? null }).eq("staff_id", stylist.id).eq("service_id", serviceId);
const status = async (id: string) => (await admin.from("ai_actions").select("status, feature, proposed_by").eq("id", id).single()).data;

async function prepare(input: Partial<Parameters<typeof prepareTask>[2]>) {
  const r = await prepareTask(manager as never, MANAGER, { task: "service_time", staffId: stylist.id, serviceId: cut, minutes: null, fromStaffId: null, ...input });
  return r;
}

beforeAll(async () => {
  [stylist, source] = await Promise.all([throwawayStylist("Tasky"), throwawayStylist("Sourcey")]);
  [manager, frontDesk] = await Promise.all([signIn("manager@mapleandash.test"), signIn("frontdesk@mapleandash.test")]);
  const { data: services } = await admin.from("services").select("id, name").eq("business_id", B).in("name", ["Women's Cut & Style", "All-Over Color"]);
  const id = (name: string) => services!.find((s) => s.name === name)!.id;
  [cut, color] = [id("Women's Cut & Style"), id("All-Over Color")];
  await admin.from("staff_services").insert([stylist.id, source.id].flatMap((staff_id) => [cut, color].map((service_id) => ({ business_id: B, staff_id, service_id }))));
  await admin.from("staff_services").update({ active_minutes: 40, processing_minutes: 0, finishing_minutes: 0 }).eq("staff_id", source.id).eq("service_id", cut);
});

afterAll(async () => {
  await admin.from("ai_actions").delete().eq("feature", "task").eq("business_id", B);
  await admin.from("staff_services").delete().in("staff_id", [stylist.id, source.id]);
  await Promise.all([stylist.remove(), source.remove()]);
});

describe("a service time task", () => {
  it("changes nothing until confirmed, then is undone back to the menu's", async () => {
    const r = await prepare({ minutes: 50 });
    expect(r.card).toMatchObject({ summary: "Tasky's Women's Cut & Style: 50 min" });
    const id = r.card!.actionId;
    expect(await status(id)).toEqual({ status: "proposed", feature: "task", proposed_by: SEED.staff.manager });
    expect((await own())[cut]).toBeNull();

    expect((await manager.rpc("apply_task_action", { p_action_id: id })).error).toBeNull();
    expect((await own())[cut]).toEqual([50, 0, 0]);
    expect((await status(id))!.status).toBe("approved");
    expect((await manager.rpc("apply_task_action", { p_action_id: id })).error?.hint).toBe("decided");

    expect((await manager.rpc("undo_task_action", { p_action_id: id })).error).toBeNull();
    expect((await own())[cut]).toBeNull();
    expect((await status(id))!.status).toBe("undone");
  });

  it("isn't confirmed once the times changed since it was prepared, nor undone once changed after", async () => {
    const r = await prepare({ minutes: 55 });
    await setOwn(cut, [45, 0, 0]);
    expect((await manager.rpc("apply_task_action", { p_action_id: r.card!.actionId })).error?.hint).toBe("changed");
    expect((await own())[cut]).toEqual([45, 0, 0]);

    const again = await prepare({ minutes: 60 });
    expect((await manager.rpc("apply_task_action", { p_action_id: again.card!.actionId })).error).toBeNull();
    await setOwn(cut, [65, 0, 0]);
    expect((await manager.rpc("undo_task_action", { p_action_id: again.card!.actionId })).error?.hint).toBe("changed");
    expect((await own())[cut]).toEqual([65, 0, 0]);
    await setOwn(cut, null);
  });

  it("is only confirmed by someone who manages the stylist", async () => {
    const r = await prepare({ minutes: 50 });
    expect((await frontDesk.rpc("apply_task_action", { p_action_id: r.card!.actionId })).error?.code).toBe("42501");
    expect((await own())[cut]).toBeNull();
    // A manager never prepares or confirms an owner's times.
    const owner = await prepareTask(manager as never, MANAGER, { task: "copy_times", staffId: SEED.staff.owner, serviceId: null, minutes: null, fromStaffId: stylist.id });
    expect(owner).toEqual({ facts: { error: "Only an owner can change Olivia's times." } });
    const { data: ids } = await manager.rpc("record_ai_proposals", {
      p_location_id: SEED.location,
      p_feature: "task",
      p_subject: null as unknown as string,
      p_options: [{ summary: "Sent in", reason: "By hand", proposal: { kind: "service_times", staff_id: SEED.staff.owner, changes: [] } }],
    });
    expect((await manager.rpc("apply_task_action", { p_action_id: ids![0] })).error?.code).toBe("42501");
  });

  it("says why it can't, and records nothing", async () => {
    expect((await prepare({ minutes: 33 })).facts).toEqual({ error: "Lengths go in steps of 5 minutes." });
    expect((await prepare({ serviceId: "00000000-0000-4000-8000-000000000000", minutes: 30 })).card).toBeUndefined();
  });
});

describe("copying another stylist's times", () => {
  it("takes theirs for every service both do", async () => {
    const r = await prepare({ task: "copy_times", fromStaffId: source.id });
    expect(r.card).toMatchObject({ summary: "Copy Sourcey's service times to Tasky", lines: ["Women's Cut & Style: 1 hr → 40 min"] });
    expect((await manager.rpc("apply_task_action", { p_action_id: r.card!.actionId })).error).toBeNull();
    expect(await own()).toEqual({ [cut]: [40, 0, 0], [color]: null });
    expect((await manager.rpc("undo_task_action", { p_action_id: r.card!.actionId })).error).toBeNull();
    expect((await own())[cut]).toBeNull();
  });
});
