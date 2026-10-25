// Denise always responds: her replies to triggers, her suggestions when a
// booking is refused, the status she shows while working, her answer
// streamed word by word, and "Something went wrong on my end" (logged)
// when something fails. No real API calls.
import { afterEach, describe, expect, it, vi } from "vitest";
import { toolStatus } from "@/lib/denise/assistant";
import { CHAT_MODEL, converse, type ClaudeClient } from "@/lib/denise/claude";
import { bookingIdeas } from "@/lib/denise/ideas";
import { callOutReply, canceledReply, lateReply, noFixAdvice } from "@/lib/denise/respond";
import { metered } from "@/lib/denise/usage";
import { checkItem, fromLocal, parseTime, type BookedItem, type BookingContext, type ItemCheck } from "@/lib/scheduling";

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("her reply to a stylist marked out", () => {
  const base = { stylist: "Gil", isToday: true, clients: 0, dayOver: false, found: null };
  it("says there's nothing to move, and why", () => {
    expect(callOutReply({ ...base, dayOver: true })).toEqual({
      text: "Gil's day is already over and there's no one left on Gil's book, so there's nothing to move. I've marked Gil out for the rest of today.",
      kind: "nothing",
    });
    expect(callOutReply(base).text).toBe("Gil has no clients left today, so there's nothing to move. No one can book Gil for the rest of the day.");
    expect(callOutReply({ ...base, isToday: false }).text).toBe("Gil has no clients that day, so there's nothing to move. No one can book Gil that day.");
  });
  it("points to her fixes, or says what staff can do when there are none", () => {
    expect(callOutReply({ ...base, clients: 3, found: { options: 2 } })).toEqual({ text: "I found 2 ways to cover Gil's 3 clients. They're in my panel for you to apply.", kind: "fixes" });
    expect(callOutReply({ ...base, clients: 1, found: { options: 1 } }).text).toBe("I found a way to cover Gil's client. They're in my panel for you to apply.");
    const stuck = callOutReply({ ...base, clients: 2, found: { options: 0 } });
    expect(stuck.kind).toBe("stuck");
    expect(stuck.text).toMatch(/^I couldn't find anyone free to take Gil's 2 clients today\. You could/);
  });
});

describe("her reply to running late", () => {
  const base = { stylist: "Bridget", client: "Mia", checkedIn: true, minutes: 15, isToday: true, nextStart: null, start: 600, alreadyPast: false, found: null };
  it("says when nothing else is affected", () => {
    expect(lateReply(base).text).toBe("Nothing else is affected: Bridget has no more clients today.");
    expect(lateReply({ ...base, isToday: false }).text).toBe("Nothing else is affected: Bridget has no more clients that day.");
    expect(lateReply({ ...base, nextStart: 14 * 60 }).text).toBe("Nothing else is affected: Bridget's next client isn't until 2pm.");
  });
  it("introduces her fixes, or what to do without one", () => {
    expect(lateReply({ ...base, found: { options: 2 } }).text).toBe("Mia's visit running 15 minutes over pushes into Bridget's next client. Here's how I'd keep the day on track.");
    expect(lateReply({ ...base, checkedIn: false, client: "Ava", minutes: 30, found: { options: 1 } }).text).toMatch(/^Ava being 30 minutes late pushes into/);
    expect(lateReply({ ...base, found: { options: 0 } })).toMatchObject({ kind: "stuck", text: expect.stringContaining("You could let Bridget's next client know") });
    for (const kind of ["client_late", "call_out", "overrun", "double_booking"]) expect(noFixAdvice(kind)).toMatch(/You could/);
  });
  it("says when the visit's time has already passed (reported hours later)", () => {
    expect(lateReply({ ...base, checkedIn: false, client: "Camila", minutes: 45, start: 15 * 60 + 15, alreadyPast: true, found: { options: 0 } })).toEqual({
      text: "Camila's 3:15pm visit should have started by now, even 45 minutes late, so there's no time left for me to move. If Camila isn't coming, you could mark it a no-show, or rebook them for another day.",
      kind: "stuck",
    });
    expect(lateReply({ ...base, alreadyPast: true }).text).toMatch(/^Mia's visit should have finished by now/);
  });
});

describe("her reply to a cancellation", () => {
  it("names the time freed and whether the waitlist fits it", () => {
    expect(canceledReply({ stylist: "Shae", start: 600, end: 660, waitlistMatches: 0 })).toEqual({
      text: "That frees 10am–11am with Shae. No one on the waitlist fits it, so it's open for booking.",
      kind: "nothing",
    });
    expect(canceledReply({ stylist: "Shae", start: 600, end: 660, waitlistMatches: 2 }).text).toBe("That frees 10am–11am with Shae. 2 clients on your waitlist could take it.");
  });
});

describe("when a booking is refused", () => {
  const TZ = "America/Chicago";
  const DAY = "2026-10-27"; // Tuesday
  const at = (t: string) => fromLocal(DAY, parseTime(t)!, TZ)!;
  const m = (t: string) => parseTime(t)!;
  const CUT = { id: "cut", activeMinutes: 60, processingMinutes: 0, finishingMinutes: 0, archived: false };
  const hours = (from: string, to: string) => ({ weekly: { 2: [{ start: m(from), end: m(to) }] }, overrides: {}, timeOff: [] });
  const ann: BookedItem = { id: "ann", appointmentId: "a", serviceId: "cut", staffId: "priya", resourceId: null, start: at("10:00"), activeMinutes: 60, processingMinutes: 0, finishingMinutes: 0 };
  const ctx: BookingContext = {
    location: { timeZone: TZ, weekly: { 2: [{ start: m("9:00"), end: m("19:00") }] } },
    services: new Map([["cut", CUT]]),
    staff: new Map([
      ["priya", { id: "priya", isActive: true, schedule: hours("9:00", "12:00"), serviceIds: new Set(["cut"]) }],
      ["ethan", { id: "ethan", isActive: true, schedule: hours("9:00", "17:00"), serviceIds: new Set(["cut"]) }],
    ]),
    resources: new Map(),
    booked: [ann],
  };
  const problemsOf = (c: ItemCheck) => (c.valid ? [] : c.problems);
  const names = new Map([
    ["priya", "Priya"],
    ["ethan", "Ethan"],
  ]);

  it("says why, and offers the nearest times with the stylist and others at that time, all within the rules", () => {
    const line = { serviceId: "cut", staffId: "priya", startMinute: m("10:30") };
    const problems = [problemsOf(checkItem(ctx, { serviceId: "cut", staffId: "priya", resourceId: null, start: at("10:30") }))];
    const ideas = bookingIdeas(ctx, DAY, [line], problems, names)!;
    expect(ideas.line).toBe(0);
    expect(ideas.text).toBe("That clashes with Priya's 10am client. Here's what's free:");
    // Priya is free 9-10 and 11-12; 11:00 and 9:00 are nearest to 10:30.
    expect(ideas.options.map((o) => o.label)).toEqual(["Priya at 11am", "Priya at 9am", "Ethan at 10:30am"]);
    for (const o of ideas.options) expect(checkItem(ctx, { serviceId: "cut", staffId: o.staffId, resourceId: null, start: fromLocal(DAY, o.startMinute, TZ)! }).valid).toBe(true);
  });

  it("says when the stylist isn't working, and when nothing is free", () => {
    const late = [problemsOf(checkItem(ctx, { serviceId: "cut", staffId: "priya", resourceId: null, start: at("13:00") }))];
    expect(bookingIdeas(ctx, DAY, [{ serviceId: "cut", staffId: "priya", startMinute: m("13:00") }], late, names)!.text).toMatch(/^Priya isn't working then\./);
    const full = { ...ctx, staff: new Map([["priya", ctx.staff.get("priya")!]]), booked: [ann, { ...ann, id: "b", start: at("9:00") }, { ...ann, id: "c", start: at("11:00") }] };
    const ideas = bookingIdeas(full, DAY, [{ serviceId: "cut", staffId: "priya", startMinute: m("10:30") }], [[{ code: "staff_double_booked", conflictWith: "ann" }]], names)!;
    expect(ideas.options).toEqual([]);
    expect(ideas.text).toMatch(/I couldn't find a free time for this that day\. You could try another day/);
    // Not about time (a missing service): nothing to suggest.
    expect(bookingIdeas(ctx, DAY, [{ serviceId: "x", staffId: "priya", startMinute: 600 }], [[{ code: "unknown_service" }]], names)).toBeNull();
  });
});

describe("while she works", () => {
  it("says what she's doing with each tool, in our words", () => {
    const c = { staff: [{ id: "b", firstName: "Bridget", title: "" }] };
    expect(toolStatus("find_openings", { staff_id: "b" }, c)).toBe("Checking Bridget's openings…");
    expect(toolStatus("find_openings", { staff_id: null }, c)).toBe("Checking everyone's openings…");
    expect(toolStatus("stylist_durations", { staff_id: "b" }, c)).toBe("Looking at how long Bridget usually takes…");
    expect(toolStatus("client_insights", { first_name: "Ava" }, c)).toBe("Looking up Ava's visits…");
    expect(toolStatus("something_new", {}, c)).toBe("Looking that up…");
  });

  // A client that streams scripted turns: each is text pieces, then
  // optionally a tool call.
  function streaming(turns: { text: string[]; tool?: { name: string; input: unknown } }[]) {
    const create = vi.fn();
    const stream = vi.fn(() => {
      const turn = turns.shift()!;
      const content = [...(turn.text.length ? [{ type: "text", text: turn.text.join("") }] : []), ...(turn.tool ? [{ type: "tool_use", id: "t1", name: turn.tool.name, input: turn.tool.input }] : [])];
      const message = { id: "m", type: "message", role: "assistant", model: CHAT_MODEL, stop_sequence: null, content, stop_reason: turn.tool ? "tool_use" : "end_turn", usage: { input_tokens: 10, output_tokens: 5 } };
      return {
        async *[Symbol.asyncIterator]() {
          for (const piece of turn.text) yield { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: piece } };
        },
        finalMessage: async () => message,
      };
    });
    return { client: { messages: { create, stream } } as unknown as ClaudeClient, create, stream };
  }

  it("streams her answer word by word, drops words before a tool, and reports each tool", async () => {
    const { client, create } = streaming([{ text: ["Let me ", "check."], tool: { name: "list_stylists", input: {} } }, { text: ["Bridget ", "is ", "free."] }]);
    const runner = { tools: [], run: vi.fn(async () => "[]") };
    const events: string[] = [];
    const text = await converse(client, "system", [{ role: "user", text: "Who's free?" }], runner as never, CHAT_MODEL, {
      onText: (t) => events.push(`text:${t}`),
      onDiscard: () => events.push("discard"),
      onTool: (name) => events.push(`tool:${name}`),
    });
    expect(text).toBe("Bridget is free.");
    expect(events).toEqual(["text:Let me ", "text:check.", "discard", "tool:list_stylists", "text:Bridget ", "text:is ", "text:free."]);
    expect(create).not.toHaveBeenCalled();
  });

  it("meters a streamed answer like any other", async () => {
    const { client } = streaming([{ text: ["Hi."] }]);
    const rpc = vi.fn(async (name: string) => (name === "ai_usage_today" ? { data: [{ used: 0, daily_limit: 1000 }], error: null } : { data: null, error: null }));
    const s = metered(client, { rpc } as never, "biz", "ask_denise").messages.stream!({ model: CHAT_MODEL, max_tokens: 10, messages: [] });
    const pieces: string[] = [];
    for await (const e of s) if (e.type === "content_block_delta" && e.delta.type === "text_delta") pieces.push(e.delta.text);
    expect(pieces).toEqual(["Hi."]);
    expect((await s.finalMessage()).content).toEqual([{ type: "text", text: "Hi." }]);
    expect(rpc).toHaveBeenCalledWith("record_ai_usage", expect.objectContaining({ p_feature: "ask_denise", p_input: 10, p_output: 5 }));
  });

  it("if something fails, says so and logs it with a reference (no details for the browser)", async () => {
    vi.doMock("@/lib/denise/session", () => ({
      deniseSession: async () => {
        throw new Error("database is down");
      },
      askerOf: () => null,
    }));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const { POST } = await import("@/app/api/denise/route");
    const response = await POST(new Request("http://x/api/denise", { method: "POST", body: JSON.stringify({ action: "canceled", date: "2026-10-27", appointmentId: "x" }) }));
    const lines = (await response.text()).trim().split("\n").map((l) => JSON.parse(l));
    expect(lines).toHaveLength(1);
    expect(lines[0].reply.kind).toBe("error");
    expect(lines[0].reply.text).toMatch(/^Something went wrong on my end, and I've logged it.* \(Ref D-[A-Z0-9]{6}\)$/);
    expect(lines[0].reply.text).not.toContain("database");
    const [tag, json] = logged.mock.calls[0] as [string, string];
    expect(tag).toBe("[denise]");
    const ref = lines[0].reply.text.match(/D-[A-Z0-9]{6}/)![0];
    expect(JSON.parse(json)).toMatchObject({ where: "canceled", kind: "bug", name: "Error", message: "database is down", ref });
    expect(JSON.parse(json).stack).toContain("denise-responds.test.ts");
    vi.doUnmock("@/lib/denise/session");
  });

  // The browser closed the page or moved on mid-reply: she stops at her next
  // step, writes nothing more and logs nothing (it used to log "Invalid
  // state: Controller is already closed" as a bug).
  const APPOINTMENT = "a0000000-0000-4000-8000-000000000001";
  const canceled = (signal?: AbortSignal) =>
    new Request("http://x/api/denise", { method: "POST", signal, body: JSON.stringify({ action: "canceled", date: "2026-10-27", appointmentId: APPOINTMENT }) });

  it("stops when the request is aborted, without writing or logging", async () => {
    const browser = new AbortController();
    const deniseDay = vi.fn();
    vi.doMock("@/lib/denise/session", () => ({
      deniseSession: async () => {
        browser.abort();
        return { me: { business_id: "biz" }, viewer: { location: {}, salon: {} }, today: "2026-10-27" };
      },
      askerOf: () => null,
    }));
    vi.doMock("@/lib/denise/day-state", () => ({ claudeFor: () => null, deniseDay }));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const { POST } = await import("@/app/api/denise/route");
    const response = await POST(canceled(browser.signal));
    const reader = response.body!.getReader();
    const read = reader.read();
    await vi.waitFor(() => expect(browser.signal.aborted).toBe(true));
    await new Promise((done) => setTimeout(done, 10));
    expect(deniseDay).not.toHaveBeenCalled();
    expect(logged).not.toHaveBeenCalled();
    await reader.cancel();
    expect((await read).done).toBe(true);
    vi.doUnmock("@/lib/denise/session");
    vi.doUnmock("@/lib/denise/day-state");
  });

  it("stops when the browser cancels the stream, without writing or logging", async () => {
    let signIn!: () => void;
    const signedIn = new Promise<void>((done) => (signIn = done));
    const deniseDay = vi.fn();
    vi.doMock("@/lib/denise/session", () => ({
      deniseSession: async () => {
        await signedIn;
        return { me: { business_id: "biz" }, viewer: { location: {}, salon: {} }, today: "2026-10-27" };
      },
      askerOf: () => null,
    }));
    vi.doMock("@/lib/denise/day-state", () => ({ claudeFor: () => null, deniseDay }));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const { POST } = await import("@/app/api/denise/route");
    const response = await POST(canceled());
    await response.body!.cancel();
    signIn();
    await new Promise((done) => setTimeout(done, 10));
    expect(deniseDay).not.toHaveBeenCalled();
    expect(logged).not.toHaveBeenCalled();
    vi.doUnmock("@/lib/denise/session");
    vi.doUnmock("@/lib/denise/day-state");
  });

  it("when the API is busy, says to try again in a minute", async () => {
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    vi.doMock("@/lib/denise/session", () => ({
      deniseSession: async () => {
        throw Anthropic.APIError.generate(529, { type: "error", error: { type: "overloaded_error", message: "Overloaded" } }, undefined, new Headers({ "request-id": "req_busy" }));
      },
      askerOf: () => null,
    }));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const { POST } = await import("@/app/api/denise/route");
    const response = await POST(new Request("http://x/api/denise", { method: "POST", body: JSON.stringify({ action: "ask", date: "2026-10-27", history: [] }) }));
    const [line] = (await response.text()).trim().split("\n").map((l) => JSON.parse(l));
    expect(line.reply.text).toMatch(/^I'm swamped right now.*ask again/);
    expect(JSON.parse(logged.mock.calls[0][1] as string)).toMatchObject({ where: "ask", kind: "busy", status: 529, apiType: "overloaded_error", requestId: "req_busy" });
    vi.doUnmock("@/lib/denise/session");
  });
});
