import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, SEED, signIn, type Client } from "./helpers";

const B = SEED.business;
let owner: Client;
let manager: Client;
let desk: Client;
let location: string;
const events: string[] = [];
const TAG = `Auto${Date.now().toString(36)}`;
const save = (c: Client, id: string | null, input: Record<string, unknown>) => c.rpc("save_event_automation", { p_business_id: B, p_id: id as string, p_input: input as never });
const newEvent = async () => {
  const { data, error } = await admin.from("events").insert({ business_id: B, location_id: location, title: `${TAG} wedding`, event_date: "2031-05-03" }).select("id").single();
  if (error) throw error;
  events.push(data.id);
  return data.id;
};

beforeAll(async () => {
  [owner, manager, desk] = await Promise.all([signIn("owner@mapleandash.test"), signIn("manager@mapleandash.test"), signIn("frontdesk@mapleandash.test")]);
  location = (await admin.from("locations").select("id").eq("business_id", B).limit(1).single()).data!.id;
});

afterAll(async () => {
  await admin.from("events").delete().in("id", events);
  await admin.from("event_automations").delete().eq("business_id", B).like("name", `${TAG}%`);
});

describe("event automations", () => {
  it("are set up by those with the settings permission", async () => {
    expect((await save(desk, null, { name: `${TAG} x`, trigger: "inquiry_received", action: "task", task: "Call", enabled: true })).error?.code).toBe("42501");
  });

  it("a message is turned on only by an owner, and changing its words turns it off", async () => {
    const message = { name: `${TAG} welcome`, trigger: "proposal_signed", action: "message", subject: "Thanks", body: "Hi {first_name}", enabled: true };
    expect((await save(manager, null, message)).error?.hint).toBe("owner");
    const { data: id, error } = await save(manager, null, { ...message, enabled: false });
    expect(error).toBeNull();
    expect((await save(owner, id as string, message)).error).toBeNull();
    // The manager renames it: still on. Changes the words: needs the owner again.
    expect((await save(manager, id as string, { ...message, name: `${TAG} welcome!` })).error).toBeNull();
    expect((await save(manager, id as string, { ...message, body: "Hello {first_name}" })).error?.hint).toBe("owner");
    const { data } = await admin.from("event_automations").select("enabled, approved_at").eq("id", id as string).single();
    expect(data!.enabled).toBe(true);
  });

  it("an inquiry adds the team's to-do after the wait, once", async () => {
    const { data: id } = await save(owner, null, { name: `${TAG} call`, trigger: "inquiry_received", action: "task", task: `${TAG} call them`, wait_days: 0, enabled: true });
    const event = await newEvent();
    const { data: runs } = await admin.from("event_automation_runs").select("status").eq("event_id", event).eq("automation_id", id as string);
    expect(runs).toEqual([{ status: "due" }]);
    const { error } = await admin.rpc("claim_event_automations", { p_business_ids: [B] });
    expect(error).toBeNull();
    await admin.rpc("claim_event_automations", { p_business_ids: [B] });
    const { data: todos } = await desk.from("event_todos").select("id, text, done_at").eq("event_id", event);
    expect(todos!.map((t) => t.text)).toEqual([`${TAG} call them`]);
    expect((await desk.rpc("set_event_todo_done", { p_todo_id: todos![0].id, p_done: true })).error).toBeNull();
    await admin.from("event_automations").update({ enabled: false }).eq("id", id as string);
  });

  it("a message comes back to be sent, and is skipped for a lost event", async () => {
    const { data: id } = await save(owner, null, { name: `${TAG} hello`, trigger: "inquiry_received", action: "message", body: "Hi {first_name}", enabled: true });
    const sent = await newEvent();
    const lost = await newEvent();
    await admin.from("events").update({ status: "lost", lost_reason: "test" }).eq("id", lost);
    const { data: due } = await admin.rpc("claim_event_automations", { p_business_ids: [B] });
    expect(due!.filter((r) => r.automation_id === id).map((r) => r.event_id)).toEqual([sent]);
    const run = due!.find((r) => r.event_id === sent)!;
    expect((await admin.rpc("finish_event_automation", { p_run_id: run.run_id, p_sent: true, p_result: "Message sent" })).error).toBeNull();
    const { data: runs } = await admin.from("event_automation_runs").select("event_id, status").eq("automation_id", id as string);
    expect(new Map(runs!.map((r) => [r.event_id, r.status]))).toEqual(new Map([[sent, "done"], [lost, "skipped"]]));
    await admin.from("event_automations").update({ enabled: false }).eq("id", id as string);
  });
});
