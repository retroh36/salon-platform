// Denise's Claude features with a fake API client: no real API calls.
import { afterEach, describe, expect, it, vi } from "vitest";
import { answer, assistantTools, type AssistantContext } from "@/lib/denise/assistant";
import { ANALYSIS_MODEL, CHAT_MODEL, claudeClient, converse, explainFixes, isConnected, modelFor, type ClaudeClient } from "@/lib/denise/claude";
import type { CoverageWeek } from "@/lib/coverage-load";
import { sayDate, type Knowledge } from "@/lib/denise/knowledge";
import { dayOffFacts, teamFacts } from "@/lib/denise/team";
import { DailyLimitReached, metered } from "@/lib/denise/usage";
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

  it("leaves out an explanation that assumes someone's gender", async () => {
    const { client } = fakeClient([text(JSON.stringify({ explanations: ["Grace keeps her slot with Priya.", "Ethan is free at 11, so they keep their time."] }))]);
    expect(await explainFixes(client, facts)).toEqual([null, "Ethan is free at 11, so they keep their time."]);
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

  it("searches and suggests with a stylist's usual time, and says so", async () => {
    // Priya has a 1pm client and usually takes 78 minutes for a cut (booked
    // as 80): from 11:30, only 11:30 still fits before 1pm.
    const busy = calendar([
      { id: "x", appointmentId: "a", serviceId: "cut", staffId: "priya", resourceId: null, start: at("13:00"), activeMinutes: 60, processingMinutes: 0, finishingMinutes: 0 },
    ]);
    const c = context({
      calendar: async () => busy,
      usualTime: (staffId, serviceId) =>
        staffId === "priya" && serviceId === "cut" ? { medianMinutes: 78, visits: 12, basis: "check_in_out" } : null,
    });
    const runner = assistantTools(c);
    const found = JSON.parse(await runner.run("find_openings", { service_id: "cut", date: DAY, staff_id: null, after: "11:30", before: "12:00", limit: 10 }));
    const priya = found.filter((o: { stylist: string }) => o.stylist === "Priya");
    expect(priya.map((o: { start: string }) => o.start)).toEqual(["11:30am"]);
    expect(priya[0]).toMatchObject({ length_minutes: 80, length_basis: "Priya's usual time (typically 1 hr 18 min over 12 visits, based on check-in to checkout times)" });
    // Ethan has no usual time yet: the booked length.
    expect(found.find((o: { stylist: string }) => o.stylist === "Ethan")).toMatchObject({ length_minutes: 60, length_basis: expect.stringContaining("booked length") });

    expect(await runner.run("propose_booking", { service_id: "cut", staff_id: "priya", date: DAY, start: "12:00", client_first_name: null })).toMatch(/already has a client/);
    const ok = JSON.parse(await runner.run("propose_booking", { service_id: "cut", staff_id: "priya", date: DAY, start: "11:30", client_first_name: null }));
    expect(ok.length_minutes).toBe(80);
    expect(c.propose).toHaveBeenCalledWith(expect.objectContaining({ timing: { activeMinutes: 80, processingMinutes: 0, finishingMinutes: 0 }, reason: expect.stringContaining("Priya's usual time") }));
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
    expect(looping.create).toHaveBeenCalledTimes(8);
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

// A fake of what Denise can look up (lib/denise/knowledge.ts).
function knowledge(overrides: Partial<Knowledge> = {}): Knowledge & Record<string, ReturnType<typeof vi.fn> | null> {
  return {
    clients: vi.fn(async (name: string) => ({ matches: [{ match: 1, first_name: name, visits: 6, usual_gap_days: 42, due_status: "overdue", days_overdue: 9 }] })),
    overdue: vi.fn(async () => ({ total_due_or_overdue: 12, clients: [{ first_name: "Liam", days_overdue: 21 }] })),
    durations: vi.fn(async () => ({ rows: [{ stylist: "Shae", service: "Men's Cut", typical_minutes: 24, visits_counted: 31, trusted: true }] })),
    salon: vi.fn(async () => ({ running_over_by_day: [{ day: "Thursday", ran_over_percent: 38 }] })),
    schedule: vi.fn(async (date: string) => ({ date, visits: [] })),
    stock: vi.fn(async () => ({ products: [] })),
    sales: vi.fn(async () => ({ total_dollars: 4210 })),
    fixes: vi.fn(async (date: string) => ({ date, problems: [] })),
    giftCards: vi.fn(async () => ({ purchased_balance_dollars: 1250, cards_with_a_balance: 14 })),
    packages: vi.fn(async () => ({ unused_value_dollars: 640, clients: [{ first_name: "Ava", uses_left: ["3 Blowout"] }] })),
    rewards: vi.fn(async () => ({ points_outstanding: 41_250, vips: { total: 3, clients: [{ first_name: "Linda", tier: "VIP" }] } })),
    policy: vi.fn(async (period: string) => ({ period, late_cancellations: 2, incidents: [{ first_name: "Liam", what: "Late cancellation" }] })),
    team: vi.fn(async (date: string) => ({ date, working: [] })),
    dayOff: vi.fn(async (date: string) => ({ date })),
    ...overrides,
  } as never;
}

describe("Ask Denise's knowledge", () => {
  it("picks the stronger model for 'why' questions and the fast one otherwise", () => {
    expect(modelFor("Why does Thursday always run late?")).toBe(ANALYSIS_MODEL);
    expect(modelFor("Compare Shae and Nola on men's cuts")).toBe(ANALYSIS_MODEL);
    expect(modelFor("Who can fit a balayage Saturday?")).toBe(CHAT_MODEL);
    expect(ANALYSIS_MODEL).toBe("claude-sonnet-5-5");
  });

  it("offers each tool only to those allowed it", () => {
    const names = (k?: Knowledge) => assistantTools(context({ knowledge: k })).tools.map((t) => t.name);
    expect(names(knowledge())).toEqual(expect.arrayContaining(["client_insights", "overdue_clients", "stylist_durations", "salon_patterns", "day_schedule", "inventory_levels", "sales_summary", "propose_fixes", "find_openings", "propose_booking"]));
    // An owner: gift card and package totals too.
    expect(names(knowledge())).toEqual(expect.arrayContaining(["gift_card_balances", "unused_packages", "rewards_summary"]));
    // The front desk: not those.
    const desk = names(knowledge({ giftCards: null, packages: null, rewards: null }));
    expect(desk).not.toContain("rewards_summary");
    expect(desk).not.toContain("gift_card_balances");
    expect(desk).not.toContain("unused_packages");
    expect(desk).toContain("late_cancellations");
    // A stylist: no sales, no fixes to approve and no one's cancellations.
    const stylist = names(knowledge({ sales: null, fixes: null, giftCards: null, packages: null, rewards: null, policy: null }));
    expect(stylist).not.toContain("sales_summary");
    expect(stylist).not.toContain("propose_fixes");
    expect(stylist).not.toContain("late_cancellations");
    // Without knowledge, just the booking tools.
    expect(names()).toEqual(["list_services", "list_stylists", "find_openings", "propose_booking"]);
  });

  it("passes tool inputs to our functions and their facts back to Claude", async () => {
    const k = knowledge();
    const c = context({ knowledge: k });
    const { client, requests } = fakeClient([
      toolUse(["t1", "stylist_durations", { staff_id: "shae", service_id: null }], ["t2", "overdue_clients", { limit: 5 }]),
      toolUse(["t3", "sales_summary", { period: "this_week" }], ["t4", "propose_fixes", { date: "2020-01-01" }], ["t5", "day_schedule", { date: "bad" }]),
      text("Shae usually takes 24 minutes for a men's cut, from 31 timed visits."),
    ]);
    const reply = await answer(client, c, [{ role: "user", text: "How long does Shae take for a men's cut?" }]);
    expect(reply.text).toBe("Shae usually takes 24 minutes for a men's cut, from 31 timed visits.");
    expect(k.durations).toHaveBeenCalledWith({ staffId: "shae", serviceId: null });
    expect(k.overdue).toHaveBeenCalledWith(5);
    expect(k.sales).toHaveBeenCalledWith("this_week");
    // Past days and bad dates are refused before anything runs.
    expect(k.fixes).not.toHaveBeenCalled();
    expect(k.schedule).not.toHaveBeenCalled();
    const results = (requests[2].messages as { role: string; content: { content: string }[] }[]).at(-1)!.content.map((r) => r.content);
    expect(results).toEqual([JSON.stringify({ total_dollars: 4210 }), "That day has passed.", "Give the date as YYYY-MM-DD."]);
    // The system prompt says numbers come from tools, and clients are never contacted.
    expect(String(requests[0].system)).toMatch(/Every number you mention must come from what you looked up/);
    expect(String(requests[0].system)).toMatch(/never contact clients or write messages to them/);
  });

  it("answers who's working Thursday night and whether Nola can have Friday off from our coverage math", async () => {
    const H = (h: number) => h * 60;
    const cell = (staffId: string, from: number | null, to = 0, clients = 0) => ({
      staffId, shifts: from == null ? [] : [{ start: H(from), end: H(to) }], draft: false, timeOff: [], clients, bookedMinutes: H(clients), lentChair: null,
    });
    const week: CoverageWeek = {
      people: [
        { id: "sam", firstName: "Sam", role: "front_desk", level: null, chair: null },
        { id: "gil", firstName: "Gil", role: "stylist", level: "master", chair: "Chair 1" },
        { id: "nola", firstName: "Nola", role: "stylist", level: "senior", chair: "Chair 2" },
      ],
      days: [
        { date: "2026-11-05", weekStart: "2026-11-02", open: [{ start: H(9), end: H(20) }], cells: [cell("sam", 12, 20), cell("gil", 9, 17), cell("nola", 12, 20)], requests: [] },
        { date: "2026-11-06", weekStart: "2026-11-02", open: [{ start: H(9), end: H(20) }], cells: [cell("sam", 9, 20), cell("gil", 9, 20), cell("nola", 9, 17, 3)], requests: [] },
      ],
    };
    const k = knowledge({
      team: vi.fn(async (date: string, part: string) => teamFacts(week, date, part as never, (d) => sayDate(d, "2026-11-01"), { flags: true })),
      dayOff: vi.fn(async (date: string, name: string) => dayOffFacts(week, date, name, (d) => sayDate(d, "2026-11-01"))),
    });
    const { client, requests } = fakeClient([
      toolUse(["t1", "who_is_working", { date: "2026-11-05", part: "evening" }], ["t2", "day_off_check", { date: "2026-11-06", first_name: "nola" }]),
      text("Sam and Nola are on Thursday night. Nola has 3 clients Friday, and Gil would be the only stylist left."),
    ]);
    await answer(client, context({ knowledge: k }), [{ role: "user", text: "Who's working Thursday night, and can I give Nola Friday off?" }]);
    const [working, dayOff] = (requests[1].messages as { content: { content: string }[] }[]).at(-1)!.content.map((r) => JSON.parse(r.content));
    expect(working).toEqual({
      date: "Thu, Nov 5", part_of_day: "evening", salon_open: "9am–8pm",
      working: [{ first_name: "Sam", role: "Front desk", level: null, hours: "noon–8pm" }, { first_name: "Nola", role: "Stylist", level: "Senior", hours: "noon–8pm" }],
      // Sam starts at noon: what Denise flags for a manager.
      flags: ["Nobody on the front desk 9am–noon on Thu, Nov 5."],
    });
    expect(dayOff).toMatchObject({ first_name: "Nola", date: "Fri, Nov 6", clients_booked_with_them: 3, stylists_left: 1, masters_left: 1, also_off: [], new_gaps_in_cover: [] });
    // Gil's 11 hours take Nola's 3 booked.
    expect(dayOff.stylists_booked_after_pct).toBe(27);
    // Only owners and managers check a day off.
    const desk = assistantTools(context({ knowledge: knowledge({ dayOff: null }) }));
    expect(desk.tools.map((t) => t.name)).toContain("who_is_working");
    expect(desk.tools.map((t) => t.name)).not.toContain("day_off_check");
    expect(await desk.run("day_off_check", { date: "2026-11-06", first_name: "Nola" })).toBe("Checking a day off is for owners and managers.");
  });

  it("refuses sales to those who can't see them, even if asked for by name", async () => {
    const runner = assistantTools(context({ knowledge: knowledge({ sales: null }) }));
    expect(await runner.run("sales_summary", { period: "today" })).toBe("Sales figures are for owners and managers.");
  });
});

describe("metering", () => {
  // A stand-in for the service-role client: usage so far, and what's recorded.
  function admin(used: number, limit = 1000) {
    const rpc = vi.fn(async (name: string) => (name === "ai_usage_today" ? { data: [{ used, daily_limit: limit }], error: null } : { data: null, error: null }));
    return { admin: { rpc } as never, rpc };
  }

  it("logs each call's tokens for the salon", async () => {
    const { client } = fakeClient([{ ...text("hi"), usage: { input_tokens: 120, output_tokens: 30, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } as never]);
    const { admin: a, rpc } = admin(0);
    await metered(client, a, "biz", "ask_denise").messages.create({ model: CHAT_MODEL, max_tokens: 10, messages: [] });
    expect(rpc).toHaveBeenCalledWith("record_ai_usage", { p_business_id: "biz", p_model: CHAT_MODEL, p_feature: "ask_denise", p_input: 120, p_output: 30, p_cache_read: 0 });
  });

  it("stops at the salon's daily limit, without calling Claude", async () => {
    const { client, create } = fakeClient([text("hi")]);
    const { admin: a } = admin(1000, 1000);
    await expect(metered(client, a, "biz", "ask_denise").messages.create({ model: CHAT_MODEL, max_tokens: 10, messages: [] })).rejects.toBeInstanceOf(DailyLimitReached);
    expect(create).not.toHaveBeenCalled();
  });
});
