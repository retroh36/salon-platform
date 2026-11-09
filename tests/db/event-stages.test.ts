import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, SEED, signIn, type Client } from "./helpers";

const B = SEED.business;
let owner: Client;
let desk: Client;
let bridget: Client;
let event: string;
let original: { id: string; name: string; kind: string | null }[];
const body = (extra: { id?: string | null; name: string; kind: null }[] = []) => [...original.map((s) => ({ id: s.id, name: s.name, kind: s.kind })), ...extra];
const save = (c: Client, stages: unknown) => c.rpc("save_event_stages", { p_business_id: B, p_stages: stages as never });
const custom = async () => (await admin.from("event_stages").select("id").eq("business_id", B).is("kind", null)).data!;

beforeAll(async () => {
  [owner, desk, bridget] = await Promise.all([signIn("owner@mapleandash.test"), signIn("frontdesk@mapleandash.test"), signIn("bridget@mapleandash.test")]);
  const { data } = await admin.from("event_stages").select("id, name, kind").eq("business_id", B).order("position");
  original = data!;
  const { data: loc } = await admin.from("locations").select("id").eq("business_id", B).limit(1).single();
  const { data: e, error } = await admin.from("events").insert({ business_id: B, location_id: loc!.id, title: "Stage test", event_date: "2030-06-01" }).select("id").single();
  if (error) throw error;
  event = e.id;
});

afterAll(async () => {
  await admin.from("events").delete().eq("id", event);
  await save(owner, body());
});

describe("event stages", () => {
  it("every salon starts with the six", () => {
    expect(original.map((s) => s.kind)).toEqual(["inquiry", "proposal_sent", "booked", "trial_done", "event_day", "completed"]);
  });
  it("only those who manage settings change them", async () => {
    expect((await save(desk, body())).error?.code).toBe("42501");
  });
  it("can't lose a built-in stage or repeat a name", async () => {
    expect((await save(owner, body().slice(1))).error?.hint).toBe("built_in");
    expect((await save(owner, body([{ name: "booked", kind: null }]))).error?.hint).toBe("duplicate");
  });
  it("a stage of the salon's own holds an event until its status changes", async () => {
    expect((await save(owner, body([{ id: null, name: "Waiting on venue", kind: null }]))).error).toBeNull();
    const [stage] = await custom();
    expect((await bridget.rpc("set_event_stage", { p_event_id: event, p_stage_id: stage.id })).error?.code).toBe("42501");
    expect((await desk.rpc("set_event_stage", { p_event_id: event, p_stage_id: original[2].id })).error?.hint).toBe("built_in");
    expect((await desk.rpc("set_event_stage", { p_event_id: event, p_stage_id: stage.id })).error).toBeNull();
    const row = async () => (await admin.from("events").select("stage_id").eq("id", event).single()).data!.stage_id;
    expect(await row()).toBe(stage.id);
    const { data: history } = await admin.from("event_history").select("detail").eq("event_id", event).eq("kind", "stage_changed");
    expect(history).toEqual([{ detail: "Waiting on venue" }]);
    await admin.from("events").update({ status: "proposal_sent" }).eq("id", event);
    expect(await row()).toBeNull();
    await admin.from("events").update({ status: "inquiry" }).eq("id", event);
  });
  it("removing a stage sends its events back", async () => {
    const [stage] = await custom();
    await desk.rpc("set_event_stage", { p_event_id: event, p_stage_id: stage.id });
    expect((await save(owner, body())).error).toBeNull();
    expect(await custom()).toEqual([]);
    expect((await admin.from("events").select("stage_id").eq("id", event).single()).data!.stage_id).toBeNull();
  });
});
