// Denise's Claude features with a fake API client: no real API calls.
import { afterEach, describe, expect, it, vi } from "vitest";
import { answer, assistantTools, type AssistantContext } from "@/lib/denise/assistant";
import { CHAT_MODEL, claudeClient, converse, explainFixes, isConnected, type ClaudeClient } from "@/lib/denise/claude";
import { fromLocal, parseTime, type BookedItem, type BookingContext } from "@/lib/scheduling";

const TZ = "America/Chicago";
const DAY = "2026-10-27"; // a Tuesday
const at = (time: string) => fromLocal(DAY, parseTime(time)!, TZ)!;

// Scripted responses, in order; records every request.
function fakeClient(responses: { content: unknown[]; stop_reason: string }[]) {
  const requests: Record<string, unknown>[] = [];
  const create = vi.fn(async (params: Record<string, unknown>) => {
    requests.push(structuredClone(params));
    const next = responses.shift();
    if (!next) throw new Error("No more scripted responses");
    return { id: "msg", type: "message", role: "assistant", model: CHAT_MODEL, stop_sequence: null, usage: {}, ...next };
  });
  return { client: { messages: { create } } as unknown as ClaudeClient, requests, create };
}

const text = (t: string) => ({ content: [{ type: "text", text: t }], stop_reason: "end_turn" });
const toolUse = (...calls: [string, string, unknown][]) => ({
  content: calls.map(([id, name, input]) => ({ type: "tool_use", id, name, input })),
  stop_reason: "tool_use",
});

const CUT = { id: "cut", activeMinutes: 60, processingMinutes: 0, finishingMinutes: 0, archived: false };
const COLOR = { id: "color", activeMinutes: 45, processingMinutes: 35, finishingMinutes: 25, archived: false };
const hours = (from: number, to: number) => ({ weekly: { 2: [{ start: from * 60, end: to * 60 }] }, overrides: {}, timeOff: [] });

function calendar(booked: BookedItem[] = []): BookingContext {
  return {
    location: { timeZone: TZ, weekly: { 2: [{ start: 9 * 60, end: 19 * 60 }] } },
    services: new Map([CUT, COLOR].map((s) => [s.id, s])),
    staff: new Map([
      ["priya", { id: "priya", isActive: true, schedule: hours(9, 18), serviceIds: new Set(["cut", "color"]) }],
      ["ethan", { id: "ethan", isActive: true, schedule: hours(9, 17), serviceIds: new Set(["cut"]) }],
    ]),
    resources: new Map([["chair-1", { id: "chair-1", isActive: true, kind: "chair" as const, sortOrder: 1 }]]),
    booked,
  };
}

function context(overrides: Partial<AssistantContext> = {}): AssistantContext & { propose: ReturnType<typeof vi.fn> } {
  const propose = vi.fn(async () => "action-1");
  return {
    salon: "Maple & Ash",
    timeZone: TZ,
    today: DAY,
    date: DAY,
    now: at("8:00"),
    services: [
      { id: "cut", name: "Women's Cut & Style", category: "Cuts", minutes: 60 },
      { id: "color", name: "All-Over Color", category: "Color", minutes: 105 },
    ],
    staff: [
      { id: "priya", firstName: "Priya", title: "Master stylist" },
      { id: "ethan", firstName: "Ethan", title: "Junior stylist" },
    ],
    calendar: async () => calendar(),
    propose,
    ...overrides,
  } as AssistantContext & { propose: ReturnType<typeof vi.fn> };
}

afterEach(() => vi.unstubAllEnvs());

describe("connecting", () => {
  it("is connected only with an API key", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    expect(isConnected()).toBe(false);
    expect(claudeClient()).toBeNull();
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key-not-real");
    expect(isConnected()).toBe(true);
    expect(claudeClient()).not.toBeNull();
  });
});

describe("explaining fixes", () => {
  const facts = [
    { problem: "Priya's running 20 minutes late.", changes: [{ client: "Grace", service: "Cut", from: "11:00 with Priya", to: "11:20 with Priya" }], clientsMoved: 1, couldNotPlace: [], breaksMoved: [], groupsKeptTogether: [] },
    { problem: "Priya's running 20 minutes late.", changes: [{ client: "Grace", service: "Cut", from: "11:00 with Priya", to: "11:00 with Ethan" }], clientsMoved: 1, couldNotPlace: [], breaksMoved: [], groupsKeptTogether: [] },
  ];

  it("asks the fast model for one explanation per fix, as JSON", async () => {
    const { client, requests } = fakeClient([text(JSON.stringify({ explanations: ["Grace waits 20 minutes and keeps Priya.", "Ethan is free at 11."] }))]);
    expect(await explainFixes(client, facts)).toEqual(["Grace waits 20 minutes and keeps Priya.", "Ethan is free at 11."]);
    expect(requests[0]).toMatchObject({ model: "claude-haiku-5-5", output_config: { effort: "low", format: { type: "json_schema" } } });
    // Only the facts: first names and times.
    expect(JSON.stringify(requests[0].messages)).toBe(JSON.stringify([{ role: "user", content: JSON.stringify({ fixes: facts }) }]));
  });

  it("falls back (null) on bad output, a short list, or a refusal", async () => {
    expect(await explainFixes(fakeClient([text("not json")]).client, facts)).toEqual([null, null]);
    expect(await explainFixes(fakeClient([text(JSON.stringify({ explanations: ["Only one."] }))]).client, facts)).toEqual(["Only one.", null]);
    expect(await explainFixes(fakeClient([{ content: [], stop_reason: "refusal" }]).client, facts)).toEqual([null, null]);
  });
});

describe("Ask Denise", () => {
  it("finds openings with tools and suggests a booking for staff to approve", async () => {
    const c = context();
    const { client, requests } = fakeClient([
      toolUse(["t1", "list_services", { query: "haircut" }], ["t2", "list_stylists", {}]),
      toolUse(["t3", "find_openings", { service_id: "cut", date: null, staff_id: "priya", after: "13:00", before: null, limit: 3 }]),
      toolUse(["t4", "propose_booking", { service_id: "cut", staff_id: "priya", date: DAY, start: "13:00", client_first_name: "Grace" }]),
      text("I found Priya free at 1pm and suggested it below."),
    ]);

    const reply = await answer(client, c, [{ role: "user", text: "Find a haircut with Priya after 1 PM" }]);
    expect(reply.text).toBe("I found Priya free at 1pm and suggested it below.");
    expect(reply.suggestions).toEqual([
      { actionId: "action-1", date: DAY, staffId: "priya", staffName: "Priya", serviceName: "Women's Cut & Style", startMinute: 13 * 60, endMinute: 14 * 60, clientHint: "Grace" },
    ]);
    expect(c.propose).toHaveBeenCalledWith(expect.objectContaining({ serviceId: "cut", staffId: "priya", start: at("13:00"), resourceId: "chair-1" }));

    // Both results of the parallel calls go back in one message.
    const second = requests[1].messages as { role: string; content: { type: string; tool_use_id: string; content: string }[] }[];
    const results = second.at(-1)!;
    expect(results.role).toBe("user");
    expect(results.content.map((r) => r.tool_use_id)).toEqual(["t1", "t2"]);
    expect(JSON.parse(results.content[0].content)).toEqual([{ service_id: "cut", name: "Women's Cut & Style", category: "Cuts", minutes: 60 }]);

    // Openings come from the booking rules: Priya from 1pm, every 15 minutes.
    const openings = JSON.parse((requests[2].messages as { content: { content: string }[] }[]).at(-1)!.content[0].content);
    expect(openings.map((o: { start: string; stylist: string }) => `${o.stylist} ${o.start}`)).toEqual(["Priya 1pm", "Priya 1:15pm", "Priya 1:30pm"]);
    expect(requests.every((r) => r.model === "claude-haiku-5-5")).toBe(true);
  });

  it("won't suggest a time the booking rules refuse, and suggests nothing", async () => {
    const busy = calendar([
      { id: "x", appointmentId: "a", serviceId: "cut", staffId: "priya", resourceId: null, start: at("13:00"), activeMinutes: 60, processingMinutes: 0, finishingMinutes: 0 },
    ]);
    const c = context({ calendar: async () => busy });
    const runner = assistantTools(c);
    const result = await runner.run("propose_booking", { service_id: "cut", staff_id: "priya", date: DAY, start: "13:30", client_first_name: null });
    expect(result).toBe("That doesn't work: The stylist already has a client then.");
    expect(c.propose).not.toHaveBeenCalled();
    expect(runner.suggestions).toEqual([]);
    // Nor in the past, nor a service the stylist doesn't offer.
    expect(await runner.run("propose_booking", { service_id: "cut", staff_id: "priya", date: "2026-10-26", start: "13:00", client_first_name: null })).toBe("That day has passed.");
    expect(await runner.run("propose_booking", { service_id: "color", staff_id: "ethan", date: DAY, start: "10:00", client_first_name: null })).toBe(
      "That doesn't work: The stylist doesn't offer this service.",
    );
  });

  it("shows suggestions without an action when the asker can't approve", async () => {
    const c = context({ propose: vi.fn(async () => null) });
    const runner = assistantTools(c);
    await runner.run("propose_booking", { service_id: "cut", staff_id: "ethan", date: DAY, start: "10:00", client_first_name: null });
    expect(runner.suggestions[0]).toMatchObject({ actionId: null, staffName: "Ethan" });
  });

  it("returns tool errors to Claude, handles refusals, and stops after a few steps", async () => {
    const c = context({ calendar: async () => Promise.reject(new Error("db down")) });
    const failing = fakeClient([toolUse(["t1", "find_openings", { service_id: "cut", date: null, staff_id: null, after: null, before: null, limit: null }]), text("Sorry, I couldn't check.")]);
    expect((await answer(failing.client, c, [{ role: "user", text: "Who's free?" }])).text).toBe("Sorry, I couldn't check.");
    const result = (failing.requests[1].messages as { content: { is_error?: boolean }[] }[]).at(-1)!.content[0];
    expect(result.is_error).toBe(true);

    expect((await answer(fakeClient([{ content: [], stop_reason: "refusal" }]).client, context(), [{ role: "user", text: "?" }])).text).toBe(
      "I can't help with that one, sorry.",
    );

    const looping = fakeClient(Array.from({ length: 10 }, () => toolUse(["t", "list_stylists", {}])));
    const tools = assistantTools(context());
    expect(await converse(looping.client, "system", [{ role: "user", text: "?" }], tools)).toMatch(/more steps/);
    expect(looping.create).toHaveBeenCalledTimes(6);
  });

  it("sends Claude no client details: the tools don't have any", async () => {
    const c = context();
    const runner = assistantTools(c);
    const outputs = await Promise.all([
      runner.run("list_services", { query: null }),
      runner.run("list_stylists", {}),
      runner.run("find_openings", { service_id: "color", date: null, staff_id: null, after: null, before: null, limit: 10 }),
    ]);
    for (const out of outputs) expect(out).not.toMatch(/phone|email|allerg|notes|@/i);
  });
});
