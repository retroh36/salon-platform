// Bridal and events: the reverse timeline across several artists, its
// checks, pricing and the payment schedule, and reading a one-line
// description (our parser, and Denise's Claude with the call mocked).
import { describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { builderProblems, priceOf, saveInput, timelineOf, type BuilderState } from "@/lib/events/builder";
import { dateOf, draftFrom, packageFor, parseDescription } from "@/lib/events/describe";
import { headcountCutoff, memberShare, pastCutoff, paymentSchedule, priceEvent, remainingSchedule, travelFee } from "@/lib/events/pricing";
import { cardLinkMessage, memberLinkMessage, proposalMessage, receiptMessage, reminderMessage } from "@/lib/events/messages";
import { pipelineColumn } from "@/lib/events/pipeline";
import { DEFAULT_EVENT_SETTINGS, type EventPackage } from "@/lib/events/types";
import { checkedDescription, describeEvent, withoutContacts } from "@/lib/denise/event-draft";
import type { ClaudeClient } from "@/lib/denise/claude";
import { laneSpans, reverseTimeline, staffClash, suggestLanes, suggestTeam, timelineProblems, type TimelineMember } from "@/lib/scheduling/events";
import type { BookingContext } from "@/lib/scheduling/booking";

const S = DEFAULT_EVENT_SETTINGS;
const PACKAGES: EventPackage[] = [
  { id: "bride", name: "Bride hair + makeup", partyRole: "bride", hairMinutes: 90, makeupMinutes: 75, priceCents: 45000, isTrial: false, isActive: true },
  { id: "bm-hair", name: "Bridesmaid hair", partyRole: "bridesmaid", hairMinutes: 45, makeupMinutes: 0, priceCents: 12000, isTrial: false, isActive: true },
  { id: "bm-both", name: "Bridesmaid hair + makeup", partyRole: "bridesmaid", hairMinutes: 45, makeupMinutes: 45, priceCents: 22000, isTrial: false, isActive: true },
  { id: "mother", name: "Mother of the bride", partyRole: "mother", hairMinutes: 45, makeupMinutes: 45, priceCents: 20000, isTrial: false, isActive: true },
  { id: "flower", name: "Flower girl", partyRole: "flower_girl", hairMinutes: 20, makeupMinutes: 0, priceCents: 5000, isTrial: false, isActive: true },
  { id: "bm-makeup", name: "Bridesmaid makeup", partyRole: "bridesmaid", hairMinutes: 0, makeupMinutes: 45, priceCents: 11000, isTrial: false, isActive: true },
  { id: "trial", name: "Trial", partyRole: "bride", hairMinutes: 60, makeupMinutes: 60, priceCents: 17500, isTrial: true, isActive: true },
];

const bride: TimelineMember = { key: "1", bride: true, hairMinutes: 90, makeupMinutes: 75 };
const maid = (key: string): TimelineMember => ({ key, bride: false, hairMinutes: 45, makeupMinutes: 45 });
const READY = 14 * 60;

describe("the reverse timeline", () => {
  const members = [bride, maid("2"), maid("3"), maid("4"), maid("5"), maid("6")];
  const tasks = reverseTimeline({ readyBy: READY, members, lanes: { hair: 2, makeup: 2 }, bufferMinutes: 10, touchUpMinutes: 15 });

  it("plans everyone back from the ready-by time, with touch-ups at the end", () => {
    expect(tasks.filter((t) => t.kind === "touch_up").map((t) => [t.start, t.end])).toEqual([
      [READY - 15, READY],
      [READY - 15, READY],
      [READY - 15, READY],
      [READY - 15, READY],
    ]);
    expect(Math.max(...tasks.filter((t) => t.kind !== "touch_up").map((t) => t.end))).toBe(READY - 15);
    // Every person gets their hair and makeup, for their package's length.
    for (const m of members) {
      expect(tasks.find((t) => t.member === m.key && t.kind === "hair")!.end - tasks.find((t) => t.member === m.key && t.kind === "hair")!.start).toBe(m.hairMinutes);
      expect(tasks.filter((t) => t.member === m.key && t.kind === "makeup")).toHaveLength(1);
    }
  });

  it("has the bride finish last, and nobody in two chairs or two people on one artist", () => {
    const brideEnd = Math.max(...tasks.filter((t) => t.member === "1").map((t) => t.end));
    expect(brideEnd).toBe(READY - 15);
    expect(tasks.filter((t) => t.member && t.member !== "1").every((t) => t.end < brideEnd)).toBe(true);
    expect(timelineProblems(tasks, READY, "1")).toEqual([]);
  });

  it("spreads the work across the artists, with a buffer between people on each", () => {
    for (const role of ["hair", "makeup"] as const) {
      for (const lane of [1, 2]) {
        const list = tasks.filter((t) => t.role === role && t.lane === lane && t.kind !== "touch_up").sort((a, b) => a.start - b.start);
        expect(list.length).toBeGreaterThanOrEqual(2);
        list.slice(1).forEach((t, i) => expect(t.start - list[i].end).toBeGreaterThanOrEqual(10));
      }
    }
    // Two artists each: the day starts much later than with one.
    const one = reverseTimeline({ readyBy: READY, members, lanes: { hair: 1, makeup: 1 }, bufferMinutes: 10, touchUpMinutes: 15 });
    expect(Math.min(...one.map((t) => t.start))).toBeLessThan(Math.min(...tasks.map((t) => t.start)) - 60);
  });

  it("gives each artist a call time before their first person", () => {
    const spans = laneSpans(tasks);
    expect(spans).toHaveLength(4);
    for (const s of spans) expect(s.call).toBe(Math.min(...tasks.filter((t) => t.role === s.role && t.lane === s.lane).map((t) => t.start)) - 15);
  });

  it("does hair before makeup for each person", () => {
    for (const m of members) {
      const hair = tasks.find((t) => t.member === m.key && t.kind === "hair")!;
      const makeup = tasks.find((t) => t.member === m.key && t.kind === "makeup")!;
      expect(makeup.start).toBeGreaterThanOrEqual(hair.end);
    }
  });

  it("finds problems after a drag", () => {
    const moved = tasks.map((t) => (t.member === "2" && t.kind === "makeup" ? { ...t, start: t.start + 600, end: t.end + 600 } : t));
    expect(timelineProblems(moved, READY, "1").map((p) => p.code)).toEqual(expect.arrayContaining(["after_ready_by", "bride_not_last"]));
    const clash = tasks.map((t) => (t.member === "3" && t.kind === "hair" ? { ...t, lane: tasks.find((x) => x.member === "2" && x.kind === "hair")!.lane, start: tasks.find((x) => x.member === "2" && x.kind === "hair")!.start, end: tasks.find((x) => x.member === "2" && x.kind === "hair")!.end } : t));
    expect(timelineProblems(clash, READY, "1").map((p) => p.code)).toContain("lane_overlap");
  });

  it("suggests enough artists for about four hours each", () => {
    expect(suggestLanes(members, 10)).toEqual({ hair: 2, makeup: 2 });
    expect(suggestLanes([bride], 10)).toEqual({ hair: 1, makeup: 1 });
    expect(suggestLanes([{ key: "1", bride: false, hairMinutes: 45, makeupMinutes: 0 }], 10)).toEqual({ hair: 1, makeup: 0 });
  });

  it("suggests the first free person for each lane, never the same person twice", () => {
    const spans = laneSpans(tasks);
    const team = suggestTeam(
      spans,
      [
        { id: "bridget", eventRoles: ["hair"] },
        { id: "lois", eventRoles: ["hair", "makeup"] },
        { id: "nola", eventRoles: ["hair"] },
        { id: "hannah", eventRoles: ["makeup"] },
      ],
      (id) => id !== "nola",
    );
    // Makeup is shorter-handed, so Lois (hair and makeup) does makeup.
    expect(Object.fromEntries(team)).toEqual({ "hair-1": "bridget", "hair-2": null, "makeup-1": "hannah", "makeup-2": "lois" });
  });
});

describe("whether a team member is free (the booking rules)", () => {
  const tz = "America/Chicago";
  const ctx = (extra: Partial<BookingContext> = {}): BookingContext => ({
    location: { timeZone: tz, weekly: {} },
    services: new Map(),
    resources: new Map(),
    staff: new Map([["s1", { id: "s1", isActive: true, schedule: { weekly: {}, overrides: {}, timeOff: [] }, serviceIds: new Set() }]]),
    booked: [],
    blocks: [],
    ...extra,
  });
  const date = "2026-11-14";
  const at = (minute: number) => new Date(Date.UTC(2026, 10, 14, 6, 0) + minute * 60_000); // Chicago is UTC-6 in November

  it("is free on an empty day, but not without the role", () => {
    expect(staffClash(ctx(), { id: "s1", eventRoles: ["hair"] }, "hair", date, { start: 480, end: 720 })).toBeNull();
    expect(staffClash(ctx(), { id: "s1", eventRoles: ["makeup"] }, "hair", date, { start: 480, end: 720 })).toBe("no_role");
  });

  it("isn't free with a client booked then, unless it's only their processing time", () => {
    const booked = [{ id: "a", serviceId: "x", staffId: "s1", resourceId: null, start: at(600), activeMinutes: 30, processingMinutes: 60, finishingMinutes: 0 }];
    expect(staffClash(ctx({ booked }), { id: "s1", eventRoles: ["hair"] }, "hair", date, { start: 480, end: 615 })).toBe("booked");
    expect(staffClash(ctx({ booked }), { id: "s1", eventRoles: ["hair"] }, "hair", date, { start: 640, end: 680 })).toBeNull();
  });

  it("isn't free on time off, blocked time or another event", () => {
    const off = ctx({ staff: new Map([["s1", { id: "s1", isActive: true, schedule: { weekly: {}, overrides: {}, timeOff: [{ startsOn: date, endsOn: date, status: "approved" }] }, serviceIds: new Set() }]]) });
    expect(staffClash(off, { id: "s1", eventRoles: ["hair"] }, "hair", date, { start: 480, end: 720 })).toBe("time_off");
    const block = (kind: string) => ctx({ blocks: [{ blockId: "b", date, staffId: "s1", kind: kind as "meeting", start: at(500), end: at(530) }] });
    expect(staffClash(block("meeting"), { id: "s1", eventRoles: ["hair"] }, "hair", date, { start: 480, end: 720 })).toBe("blocked");
    expect(staffClash(block("event"), { id: "s1", eventRoles: ["hair"] }, "hair", date, { start: 480, end: 720 })).toBe("other_event");
    // This event's own hold doesn't count.
    expect(staffClash(block("event"), { id: "s1", eventRoles: ["hair"] }, "hair", date, { start: 480, end: 720 }, new Set(["b"]))).toBeNull();
  });
});

describe("pricing", () => {
  const party = [{ priceCents: 45000, paysOwn: false }, ...Array.from({ length: 5 }, () => ({ priceCents: 22000, paysOwn: false }))];

  it("adds travel, early starts, the service charge and tax, and works out the deposit", () => {
    const p = priceEvent({ members: party, billing: "main", onLocation: true, travelMiles: 14.2, earlyLanes: 2 }, S, 800);
    expect(p.subtotalCents).toBe(155000);
    expect(p.travelFeeCents).toBe(7500 + 150 * 5);
    expect(p.earlyFeeCents).toBe(10000);
    expect(p.serviceChargeCents).toBe(31000);
    expect(p.taxCents).toBe(Math.floor(((155000 + 8250 + 10000) * 800 + 5000) / 10000));
    expect(p.totalCents).toBe(155000 + 8250 + 10000 + 31000 + p.taxCents);
    expect(p.depositCents).toBe(Math.floor((p.totalCents * 30 + 50) / 100));
  });

  it("splits: members paying their own pay their package, its service charge and tax; the deposit is on the rest", () => {
    const split = party.map((m, i) => ({ ...m, paysOwn: i > 0 && i < 3 }));
    const p = priceEvent({ members: split, billing: "split", onLocation: false, travelMiles: 0, earlyLanes: 0 }, S, 0);
    expect(memberShare(22000, S, 0)).toBe(26400);
    expect(p.ownCents).toBe(2 * 26400);
    expect(p.mainCents).toBe(p.totalCents - 52800);
    expect(p.depositCents).toBe(Math.floor((p.mainCents * 30 + 50) / 100));
    // Without split billing, nobody pays their own.
    expect(priceEvent({ members: split, billing: "main", onLocation: false, travelMiles: 0, earlyLanes: 0 }, S, 0).ownCents).toBe(0);
  });

  it("charges no travel for free miles", () => {
    expect(travelFee(8, S)).toBe(7500);
    expect(travelFee(10.1, S)).toBe(7650);
  });
});

describe("the payment schedule", () => {
  const plan = { ...S, secondPaymentPct: 30, secondPaymentDays: 30, finalPaymentDays: 7 };

  it("is the deposit to book, a second payment and the balance before the event", () => {
    expect(paymentSchedule({ mainCents: 100000, depositCents: 30000, eventDate: "2027-06-14", bookedOn: "2026-11-01" }, plan)).toEqual([
      { kind: "deposit", amountCents: 30000, dueOn: "2026-11-01" },
      { kind: "second", amountCents: 30000, dueOn: "2027-05-15" },
      { kind: "final", amountCents: 40000, dueOn: "2027-06-07" },
    ]);
  });

  it("folds payments that would be due already into the next", () => {
    expect(paymentSchedule({ mainCents: 100000, depositCents: 30000, eventDate: "2026-11-20", bookedOn: "2026-11-01" }, plan)).toEqual([
      { kind: "deposit", amountCents: 30000, dueOn: "2026-11-01" },
      { kind: "final", amountCents: 70000, dueOn: "2026-11-13" },
    ]);
    expect(paymentSchedule({ mainCents: 100000, depositCents: 30000, eventDate: "2026-11-05", bookedOn: "2026-11-01" }, plan)).toEqual([
      { kind: "deposit", amountCents: 30000, dueOn: "2026-11-01" },
      { kind: "final", amountCents: 70000, dueOn: "2026-11-01" },
    ]);
  });

  it("knows the headcount cutoff", () => {
    expect(headcountCutoff("2027-06-14", S)).toBe("2027-05-31");
    expect(pastCutoff("2027-06-14", "2027-05-31", S)).toBe(false);
    expect(pastCutoff("2027-06-14", "2027-06-01", S)).toBe(true);
  });
});

describe("reading a one-line description", () => {
  it("reads the example", () => {
    const d = parseDescription("June 14 wedding, ready by 2pm, bride plus 5 bridesmaids hair and makeup, at the Grand Hotel");
    expect(d).toMatchObject({ month: 6, day: 14, readyHour: 14, readyMinute: 0, venue: "The Grand Hotel", kind: "wedding" });
    expect(d.groups).toEqual([
      { partyRole: "bride", count: 1, services: "hair_makeup" },
      { partyRole: "bridesmaid", count: 5, services: "hair_makeup" },
    ]);
  });

  it("reads several groups with their own services, and the salon", () => {
    const d = parseDescription("Rossi wedding Sat May 2nd ready at 11:30am: bride hair and makeup, 4 bridesmaids hair only, mother of the bride makeup, 2 flower girls, in salon");
    expect(d).toMatchObject({ month: 5, day: 2, readyHour: 11, readyMinute: 30, inSalon: true, name: "Rossi", venue: null });
    expect(d.groups.map((g) => [g.partyRole, g.count, g.services])).toEqual([
      ["bride", 1, "hair_makeup"],
      ["bridesmaid", 4, "hair"],
      ["mother", 1, "makeup"],
      ["flower_girl", 2, null],
    ]);
  });

  it("finds the next date on or after today", () => {
    expect(dateOf({ month: 6, day: 14, year: null }, "2026-10-25")).toBe("2027-06-14");
    expect(dateOf({ month: 11, day: 1, year: null }, "2026-10-25")).toBe("2026-11-01");
    expect(dateOf({ month: 2, day: 30, year: null }, "2026-10-25")).toBeNull();
  });

  it("drafts the party with packages, bride first", () => {
    const draft = draftFrom(parseDescription("June 14 wedding, ready by 2pm, bride plus 5 bridesmaids hair and makeup, at the Grand Hotel"), PACKAGES, "2026-10-25");
    expect(draft).toMatchObject({ title: "Wedding on Jun 14", date: "2027-06-14", readyBy: 840, venue: "The Grand Hotel", onLocation: true });
    expect(draft.members.map((m) => [m.name, m.packageId])).toEqual([
      ["Bride", "bride"],
      ["Bridesmaid 1", "bm-both"],
      ["Bridesmaid 2", "bm-both"],
      ["Bridesmaid 3", "bm-both"],
      ["Bridesmaid 4", "bm-both"],
      ["Bridesmaid 5", "bm-both"],
    ]);
  });

  it("picks packages by role and services", () => {
    expect(packageFor("bridesmaid", "hair", PACKAGES)?.id).toBe("bm-hair");
    expect(packageFor("maid_of_honor", "makeup", PACKAGES)?.id).toBe("bm-makeup");
    expect(packageFor("mother", null, PACKAGES)?.id).toBe("mother");
    // Trials are never part of the day.
    expect(packageFor("bride", "hair_makeup", PACKAGES)?.id).toBe("bride");
  });
});

// A stand-in for the SDK: answers with the text given and records the call.
function fakeClaude(answer: unknown, stop: Anthropic.Message["stop_reason"] = "end_turn") {
  const create = vi.fn(async () => ({ stop_reason: stop, content: [{ type: "text", text: typeof answer === "string" ? answer : JSON.stringify(answer) }], usage: { input_tokens: 10, output_tokens: 10 } }) as unknown as Anthropic.Message);
  return { client: { messages: { create } } as ClaudeClient, create };
}

describe("Denise's draft (Claude mocked)", () => {
  const line = "Rossi wedding June 14, ready by 2pm, bride + 3 bridesmaids hair and makeup and a flower girl, at Lakeside Barn. Call Mia 312-555-0142 or mia@example.com";
  const answer = {
    month: 6, day: 14, year: null, ready_hour: 14, ready_minute: 0, venue: "Lakeside Barn", in_salon: false, kind: "wedding", name: "Rossi",
    groups: [
      { party_role: "bride", count: 1, services: "hair_makeup" },
      { party_role: "bridesmaid", count: 3, services: "hair_makeup" },
      { party_role: "flower_girl", count: 1, services: null },
    ],
  };

  it("sends the line without contact details and drafts the event from what Claude read", async () => {
    const { client, create } = fakeClaude(answer);
    const described = await describeEvent(client, line);
    expect(described.by).toBe("denise");
    const sent = (create.mock.calls[0] as unknown as [Anthropic.MessageCreateParamsNonStreaming])[0];
    expect(JSON.stringify(sent.messages)).not.toMatch(/555|example\.com/);
    expect(sent.output_config?.format).toMatchObject({ type: "json_schema" });
    const draft = draftFrom(described.description, PACKAGES, "2026-10-25");
    expect(draft).toMatchObject({ title: "Rossi wedding", date: "2027-06-14", readyBy: 840, venue: "Lakeside Barn", onLocation: true });
    expect(draft.members.map((m) => m.packageId)).toEqual(["bride", "bm-both", "bm-both", "bm-both", "flower"]);
  });

  it("falls back to reading it ourselves when Claude's answer doesn't check out", async () => {
    for (const bad of ["not json", { ...answer, groups: [{ party_role: "bride", count: 400, services: "hair" }] }, { ...answer, groups: [] }]) {
      const described = await describeEvent(fakeClaude(bad).client, line);
      expect(described.by).toBe("parser");
      expect(described.description.groups[0]).toMatchObject({ partyRole: "bride" });
    }
    expect((await describeEvent(fakeClaude(answer, "max_tokens").client, line)).by).toBe("parser");
  });

  it("falls back when Claude fails, and reports the error", async () => {
    const client = { messages: { create: vi.fn(async () => Promise.reject(new Error("overloaded"))) } } as unknown as ClaudeClient;
    const onError = vi.fn();
    expect((await describeEvent(client, line, onError)).by).toBe("parser");
    expect(onError).toHaveBeenCalledOnce();
    expect((await describeEvent(null, line)).by).toBe("parser");
  });

  it("checks every field", () => {
    expect(checkedDescription({ ...answer, month: 13, ready_hour: 30 })).toMatchObject({ month: null, readyHour: null });
    expect(checkedDescription({ groups: "x" })).toBeNull();
    expect(withoutContacts("text Ana at (312) 555-0142, ana@x.co")).toBe("text Ana at [phone], [email]");
  });
});

describe("the builder", () => {
  const state = (patch: Partial<BuilderState> = {}): BuilderState => ({
    title: "Rossi wedding",
    clientId: "c1",
    clientName: "Mia Rossi",
    newClient: null,
    date: "2027-06-14",
    readyBy: 840,
    onLocation: true,
    venueName: "Lakeside Barn",
    venueAddress: "",
    travelMiles: 20,
    travelMinutes: 30,
    notes: "",
    billing: "main",
    members: [
      { name: "Mia", partyRole: "bride", packageId: "bride", paysOwn: false, email: "", phone: "" },
      { name: "Ana", partyRole: "bridesmaid", packageId: "bm-both", paysOwn: false, email: "", phone: "" },
    ],
    lanes: { hair: 1, makeup: 1 },
    team: { "hair-1": "s-hair", "makeup-1": "s-makeup" },
    tasks: null,
    source: "desk",
    described: "",
    ...patch,
  });

  it("works out the timeline and price, and saves the timeline as instants with the team", () => {
    const s = state();
    const tasks = timelineOf(s, PACKAGES, S);
    expect(tasks.length).toBe(6);
    const price = priceOf(s, PACKAGES, S, 0, tasks);
    expect(price.subtotalCents).toBe(67000);
    expect(price.travelFeeCents).toBe(7500 + 150 * 10);
    const input = saveInput(s, tasks, "America/Chicago");
    expect(input.ready_by).toBe("2027-06-14T19:00:00.000Z");
    expect(input.tasks.every((t) => t.staff_id === (t.role === "hair" ? "s-hair" : "s-makeup"))).toBe(true);
    expect(builderProblems(s, PACKAGES, S, "2026-10-25")).toEqual([]);
  });

  it("says what's missing", () => {
    expect(builderProblems(state({ clientId: null, title: " ", readyBy: null }), PACKAGES, S, "2026-10-25")).toEqual([
      "Give the event a name.",
      "Choose the client, or add their name and a phone number or email.",
      "Add the ready-by time.",
    ]);
    expect(builderProblems(state({ members: [{ name: "x", partyRole: "bride", packageId: "trial", paysOwn: false, email: "", phone: "" }] }), PACKAGES, S, "2026-10-25")).toContain("Choose a package for everyone in the party.");
  });
});

describe("what's left to pay once booked", () => {
  const plan = { ...S, secondPaymentPct: 30, secondPaymentDays: 30, finalPaymentDays: 7 };
  const base = { mainCents: 100000, eventDate: "2027-06-14", bookedOn: "2026-11-01", today: "2026-11-01" };

  it("matches the proposal's schedule at booking", () => {
    expect(remainingSchedule({ ...base, paid: [{ kind: "deposit", amountCents: 30000 }] }, plan)).toEqual(
      paymentSchedule({ mainCents: 100000, depositCents: 30000, eventDate: "2027-06-14", bookedOn: "2026-11-01" }, plan).slice(1),
    );
  });

  it("follows a bigger party: the second payment is its share of the new total, the balance takes the rest", () => {
    expect(remainingSchedule({ ...base, mainCents: 120000, today: "2027-01-10", paid: [{ kind: "deposit", amountCents: 30000 }] }, plan)).toEqual([
      { kind: "second", amountCents: 36000, dueOn: "2027-05-15" },
      { kind: "final", amountCents: 54000, dueOn: "2027-06-07" },
    ]);
  });

  it("after the second payment, only the balance changes; overpaid leaves nothing", () => {
    const paid = [
      { kind: "deposit" as const, amountCents: 30000 },
      { kind: "second" as const, amountCents: 30000 },
    ];
    expect(remainingSchedule({ ...base, mainCents: 90000, today: "2027-05-20", paid }, plan)).toEqual([{ kind: "final", amountCents: 30000, dueOn: "2027-06-07" }]);
    expect(remainingSchedule({ ...base, mainCents: 50000, today: "2027-05-20", paid }, plan)).toEqual([]);
  });

  it("makes anything whose day has passed due today", () => {
    expect(remainingSchedule({ ...base, today: "2027-06-09", paid: [{ kind: "deposit", amountCents: 30000 }] }, plan)).toEqual([
      { kind: "second", amountCents: 30000, dueOn: "2027-06-09" },
      { kind: "final", amountCents: 40000, dueOn: "2027-06-09" },
    ]);
  });
});

describe("the Events board", () => {
  it("puts a booked event whose day has come under Event day", () => {
    expect(pipelineColumn("booked", "2026-11-01", "2026-10-31")).toBe("booked");
    expect(pipelineColumn("trial_done", "2026-11-01", "2026-11-01")).toBe("event_day");
    expect(pipelineColumn("inquiry", "2026-10-01", "2026-11-01")).toBe("inquiry");
    expect(pipelineColumn("completed", "2026-10-01", "2026-11-01")).toBe("completed");
  });
});

describe("messages about events", () => {
  it("are fixed templates with the link, and name the amount and card", () => {
    expect(proposalMessage("Maple & Ash", "Mia", "Rossi wedding", "https://x/event/abc", "email")).toEqual({
      subject: "Your proposal from Maple & Ash",
      body: expect.stringContaining("https://x/event/abc"),
    });
    expect(proposalMessage("Maple & Ash", "Mia", "Rossi wedding", "u", "sms").subject).toBeNull();
    expect(memberLinkMessage("Maple & Ash", "Ana", "Rossi wedding", 26400, "u", "sms").body).toContain("Your share is $264");
    expect(cardLinkMessage("Maple & Ash", "Mia", "Rossi wedding", "u", "sms").body).toContain("didn't go through");
    expect(reminderMessage("Maple & Ash", "Mia", "Rossi wedding", "final", 54000, "Mon, Jun 7", "Visa …4242").body).toContain("balance of $540 for Rossi wedding will be charged to Visa …4242 on Mon, Jun 7");
    expect(receiptMessage("Maple & Ash", "Mia", "Rossi wedding", "Deposit", 30000, "Visa …4242", 70000).body).toContain("$700 is left to pay");
    expect(receiptMessage("Maple & Ash", "Mia", "Rossi wedding", "Balance", 30000, null, 0).body).toContain("That's everything paid");
  });

  it("never say anything with an exclamation mark", () => {
    for (const m of [proposalMessage("S", "A", "T", "u", "sms"), memberLinkMessage("S", "A", "T", 1, "u", "sms"), cardLinkMessage("S", "A", "T", "u", "sms"), reminderMessage("S", "A", "T", "second", 1, "d", null), receiptMessage("S", "A", "T", "Deposit", 1, null, 0)]) {
      expect(m.body).not.toContain("!");
    }
  });
});
