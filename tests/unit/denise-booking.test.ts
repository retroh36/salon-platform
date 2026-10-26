// Booking by asking Denise: reading the line (Claude mocked), the dates and
// the client's name in our code, the slot search and ranking over the
// booking rules, and each turn of the chat (alternatives, which client, a
// new client, follow-ups, and the form without her).
import { describe, expect, it, vi } from "vitest";
import { CHAT_MODEL, type ClaudeClient } from "@/lib/denise/claude";
import { bookingTurn, mightBeBooking, pickClient, stateOf, type BookingDeps, type BookingSlot, type ClientMatch, type TimesFound } from "@/lib/denise/booking-chat";
import { checkedParse, readBookingRequest, type BookingMenu, type BookingParse } from "@/lib/denise/booking-request";
import { applyChange, clientWords, datesFor, guessRequest, maskedLine, phoneTimes, requestFrom, vocabularyOf, windowOf, type PhoneRequest } from "@/lib/phone-booking";
import { checkAppointment, fromLocal, parseTime, staffBusySpans, timingFor, type BookedItem, type BookingContext, type ServiceTiming } from "@/lib/scheduling";
import { rankVisits, searchVisits, type VisitSearch } from "@/lib/scheduling/phone";

const TZ = "America/Chicago";
const TUE = "2026-10-27";
const WED = "2026-10-28";
const at = (time: string, day = TUE) => fromLocal(day, parseTime(time)!, TZ)!;
const m = (time: string) => parseTime(time)!;
const hhmm = (minute: number) => `${Math.floor(minute / 60)}:${String(minute % 60).padStart(2, "0")}`;

const BALAYAGE = { id: "balayage", activeMinutes: 75, processingMinutes: 40, finishingMinutes: 40, archived: false };
const CUT = { id: "cut", activeMinutes: 60, processingMinutes: 0, finishingMinutes: 0, archived: false };
const TRIM = { id: "trim", activeMinutes: 30, processingMinutes: 0, finishingMinutes: 0, archived: false };
const shift = (from: string, to: string) => ({ start: m(from), end: m(to) });
const week = (from: string, to: string) => ({ 2: [shift(from, to)], 3: [shift(from, to)], 4: [shift(from, to)] });

function ctx(booked: BookedItem[] = []): BookingContext {
  return {
    location: { timeZone: TZ, weekly: week("9:00", "19:00") },
    services: new Map([BALAYAGE, CUT, TRIM].map((s) => [s.id, s])),
    staff: new Map([
      ["bridget", { id: "bridget", isActive: true, schedule: { weekly: week("9:00", "17:00"), overrides: {}, timeOff: [] }, serviceIds: new Set(["balayage", "cut", "trim"]) }],
      ["gil", { id: "gil", isActive: true, schedule: { weekly: week("9:00", "17:00"), overrides: {}, timeOff: [] }, serviceIds: new Set(["balayage", "cut", "trim"]) }],
      ["shae", { id: "shae", isActive: true, schedule: { weekly: week("12:00", "17:00"), overrides: {}, timeOff: [] }, serviceIds: new Set(["cut", "trim"]) }],
    ]),
    resources: new Map(["chair-1", "chair-2", "chair-3"].map((id, i) => [id, { id, isActive: true, kind: "chair" as const, sortOrder: i }])),
    booked,
    blocks: [],
  };
}

const booked = (id: string, svc: typeof CUT, staffId: string, time: string, day = TUE, resourceId: string | null = null): BookedItem => ({
  id,
  appointmentId: `a-${id}`,
  serviceId: svc.id,
  staffId,
  resourceId,
  start: at(time, day),
  activeMinutes: svc.activeMinutes,
  processingMinutes: svc.processingMinutes,
  finishingMinutes: svc.finishingMinutes,
});

const EARLY = at("0:00");
const search = (c: BookingContext, s: Partial<VisitSearch> & Pick<VisitSearch, "serviceIds">) =>
  searchVisits(c, { staffIds: null, dates: [TUE], from: 0, to: 24 * 60 - 1, notBefore: EARLY, timingOf: (staffId, serviceId) => timingFor(c, staffId, serviceId), ...s });

describe("finding times for a visit", () => {
  it("books services back to back, the second starting when the first really ends", () => {
    const found = search(ctx(), { serviceIds: ["balayage", "cut"], staffIds: ["bridget"] });
    const first = found[0];
    expect(hhmm(first.minute)).toBe("9:00");
    // 75 + 40 + 40 minutes of balayage, then the cut.
    expect(first.lines.map((l) => [l.serviceId, l.staffId, hhmm(l.startMinute)])).toEqual([
      ["balayage", "bridget", "9:00"],
      ["cut", "bridget", "11:35"],
    ]);
    expect(first.end).toEqual(at("12:35"));
  });

  it("lets another client sit in the processing gap, but not in the stylist's own time", () => {
    // Bridget has a 30-minute trim at 11:15.
    const c = ctx([booked("t", TRIM, "bridget", "11:15", TUE, "chair-3")]);
    const starts = search(c, { serviceIds: ["balayage"], staffIds: ["bridget"] }).map((x) => hhmm(x.minute));
    // 10:00: hands-on to 11:15, processing 11:15–11:55 (the trim fits), finishing from 11:55.
    expect(starts).toContain("10:00");
    // 9:45: finishing starts at 11:40, while the trim is still in the chair.
    expect(starts).not.toContain("9:45");
    // 9:00: processing 10:15–10:55 and finishing ends at 11:35, over the trim.
    expect(starts).not.toContain("10:15");
  });

  it("never offers a time that double-books anyone", () => {
    const c = ctx([booked("1", CUT, "bridget", "10:00", TUE, "chair-1"), booked("2", BALAYAGE, "gil", "9:30", TUE, "chair-2"), booked("3", TRIM, "shae", "13:00", TUE, "chair-3")]);
    const found = search(c, { serviceIds: ["balayage", "cut"] });
    expect(found.length).toBeGreaterThan(10);
    for (const x of found) {
      const check = checkAppointment(
        c,
        x.lines.map((l) => ({ serviceId: l.serviceId, staffId: l.staffId, resourceId: l.resourceId, start: l.start, timing: l.timing })),
      );
      expect(check.valid).toBe(true);
      for (const l of x.lines) {
        const mine = staffBusySpans({ ...l.timing, serviceId: l.serviceId, staffId: l.staffId, start: l.start });
        const theirs = c.booked.filter((b) => b.staffId === l.staffId).flatMap(staffBusySpans);
        expect(mine.some((a) => theirs.some((b) => a.start < b.end && b.start < a.end))).toBe(false);
      }
    }
  });

  it("checks each stylist at the length they really take", () => {
    const c = ctx([booked("1", CUT, "bridget", "10:30", TUE, "chair-1")]);
    const usual: ServiceTiming = { activeMinutes: 90, processingMinutes: 0, finishingMinutes: 0 };
    const menu = search(c, { serviceIds: ["cut"], staffIds: ["bridget"] }).map((x) => hhmm(x.minute));
    const learned = search(c, { serviceIds: ["cut"], staffIds: ["bridget"], timingOf: (staffId, serviceId) => (serviceId === "cut" ? usual : timingFor(c, staffId, serviceId)) });
    // At the menu's hour, 9:15–10:15 fits before the 10:30; at Bridget's 90 minutes it doesn't.
    expect(menu).toContain("9:15");
    expect(learned.map((x) => hhmm(x.minute))).not.toContain("9:15");
    expect(learned[0].end).toEqual(at("10:30"));
  });

  it("keeps to the stylists asked for and the part of the day", () => {
    const found = search(ctx(), { serviceIds: ["cut"], staffIds: ["shae"], ...windowOf({ part: "afternoon", after: null, before: null }) });
    expect(new Set(found.map((x) => x.lines[0].staffId))).toEqual(new Set(["shae"]));
    expect(Math.min(...found.map((x) => x.minute))).toBe(m("12:00"));
    expect(Math.max(...found.map((x) => x.minute))).toBeLessThanOrEqual(m("16:59"));
  });
});

const NAMES = new Map([
  ["bridget", "Bridget"],
  ["gil", "Gil"],
  ["shae", "Shae"],
]);

describe("ranking the times", () => {
  it("puts the client's usual stylist and day first, and says why", () => {
    const c = ctx([booked("1", CUT, "bridget", "13:00", WED, "chair-1")]);
    const found = search(c, { serviceIds: ["cut"], dates: [TUE, WED] });
    const best = rankVisits(c, found, { usualStaffId: "bridget", usualWeekday: 3, usualPart: "afternoon" }, NAMES);
    expect(best).toHaveLength(3);
    expect(best[0].lines[0].staffId).toBe("bridget");
    expect(best[0].date).toBe(WED);
    // Snug against the 1pm client, on the Wednesday they usually come.
    expect(best[0].reason).toMatch(/^Bridget's usual Wednesday, right (after|before) the 1pm client/);
  });

  it("offers three different times, not three starts a quarter hour apart", () => {
    const c = ctx();
    const best = rankVisits(c, search(c, { serviceIds: ["cut"] }), { usualStaffId: null, usualWeekday: null, usualPart: null }, NAMES);
    for (const [i, a] of best.entries()) {
      for (const b of best.slice(i + 1)) {
        if (a.lines[0].staffId === b.lines[0].staffId && a.date === b.date) expect(Math.abs(a.minute - b.minute)).toBeGreaterThanOrEqual(90);
      }
    }
  });

  it("puts the earliest first when that's what was asked", () => {
    const c = ctx([booked("1", CUT, "bridget", "9:00", TUE, "chair-1"), booked("2", CUT, "gil", "9:00", TUE, "chair-2")]);
    const found = search(c, { serviceIds: ["cut"], dates: [TUE, WED] });
    const best = rankVisits(c, found, { usualStaffId: null, usualWeekday: null, usualPart: null }, NAMES, { earliest: true });
    expect(best[0].date).toBe(TUE);
    expect(hhmm(best[0].minute)).toBe("10:00");
    expect(best[0].reason).toBe("Right after Bridget's 9am client, leaves 11am onward open");
  });

  it("marks a time that leaves a gap too short to book down", () => {
    const c = ctx([booked("1", CUT, "gil", "11:00", TUE, "chair-1")]);
    const found = search(c, { serviceIds: ["cut"], staffIds: ["gil"], from: m("9:30"), to: m("10:00") });
    const best = rankVisits(c, found, { usualStaffId: null, usualWeekday: null, usualPart: null }, NAMES, { count: 1 });
    // 10:00 ends right at the 11am client; 9:30 would leave 30 idle minutes.
    expect(hhmm(best[0].minute)).toBe("10:00");
  });
});

describe("nearest alternatives when nothing fits", () => {
  const STYLISTS = [
    { id: "bridget", firstName: "Bridget", level: "master" as const },
    { id: "gil", firstName: "Gil", level: "master" as const },
    { id: "shae", firstName: "Shae", level: "artisan" as const },
  ];
  const ask = (patch: Partial<PhoneRequest>): PhoneRequest => ({
    clientText: null,
    sameAsLast: false,
    serviceIds: ["balayage"],
    staffId: "bridget",
    level: null,
    from: TUE,
    to: TUE,
    part: null,
    after: null,
    before: null,
    earliest: false,
    ...patch,
  });

  it("offers another day and another stylist at the same level", () => {
    // Bridget's Tuesday is full.
    const c = ctx(["9:00", "11:00", "13:00", "15:00"].map((t, i) => booked(`b${i}`, { ...CUT, activeMinutes: 120 }, "bridget", t, TUE, "chair-1")));
    const r = phoneTimes(c, ask({}), { stylists: STYLISTS, timingOf: (s, v) => timingFor(c, s, v), habits: { usualStaffId: null, usualWeekday: null, usualPart: null }, now: EARLY });
    expect(r.options).toEqual([]);
    expect(r.otherDays.length).toBeGreaterThan(0);
    expect(r.otherDays.every((o) => o.date > TUE && o.lines[0].staffId === "bridget")).toBe(true);
    // Gil is the other master; Shae doesn't do balayage.
    expect(r.sameLevel.map((o) => o.lines[0].staffId)).toEqual(["gil", "gil"]);
  });

  it("doesn't look further when something fits", () => {
    const c = ctx();
    const r = phoneTimes(c, ask({}), { stylists: STYLISTS, timingOf: (s, v) => timingFor(c, s, v), habits: { usualStaffId: null, usualWeekday: null, usualPart: null }, now: EARLY });
    expect(r.options.length).toBeGreaterThan(0);
    expect(r.otherDays).toEqual([]);
    expect(r.sameLevel).toEqual([]);
  });
});

describe("dates from the words", () => {
  // Tuesday, October 27.
  it("works out weeks, weekdays and dates", () => {
    expect(datesFor({ kind: "next_week" }, TUE)).toEqual({ from: "2026-11-02", to: "2026-11-08" });
    expect(datesFor({ kind: "this_week" }, TUE)).toEqual({ from: TUE, to: "2026-11-01" });
    expect(datesFor({ kind: "tomorrow" }, TUE)).toEqual({ from: WED, to: WED });
    expect(datesFor({ kind: "weekday", weekday: 2, next: false }, TUE)).toEqual({ from: TUE, to: TUE });
    expect(datesFor({ kind: "weekday", weekday: 5, next: false }, TUE)).toEqual({ from: "2026-10-30", to: "2026-10-30" });
    expect(datesFor({ kind: "weekday", weekday: 2, next: true }, TUE)).toEqual({ from: "2026-11-03", to: "2026-11-03" });
    expect(datesFor({ kind: "date", month: 11, day: 14 }, TUE)).toEqual({ from: "2026-11-14", to: "2026-11-14" });
    // A date that's passed this year is next year's.
    expect(datesFor({ kind: "date", month: 3, day: 2 }, TUE)).toEqual({ from: "2027-03-02", to: "2027-03-02" });
    expect(datesFor({ kind: "soon" }, TUE)).toEqual({ from: TUE, to: "2026-11-09" });
  });
});

const VOCAB = vocabularyOf(["Balayage", "Women's Cut & Style", "Cuts", "Men's Cut", "Gloss / Toner", "Color", "Bridget", "Gil", "Nola"]);

describe("the client in the line", () => {
  it("is the words that aren't about the booking", () => {
    expect(clientWords("Maria Lopez, balayage + cut with Bridget next week, afternoons", VOCAB)).toBe("Maria Lopez");
    expect(clientWords("same as last time for Zoey", VOCAB)).toBe("Zoey");
    expect(clientWords("earliest men's cut with anyone", VOCAB)).toBeNull();
    expect(clientWords("maria lopez gloss tuesday", VOCAB)).toBe("maria lopez");
    expect(clientWords("312-555-0142 wants a gloss", VOCAB)).toBe("312-555-0142");
  });

  it("never reaches Denise: the name, phone and email are taken out", () => {
    const masked = maskedLine("Maria Lopez (312) 555-0142 maria@example.com, balayage with Bridget", "Maria Lopez");
    expect(masked).toBe("[client] [client] [phone] [email], balayage with Bridget");
  });
});

const MENU: BookingMenu = {
  services: [
    { id: "svc-balayage", name: "Balayage", category: "Balayage" },
    { id: "svc-womens", name: "Women's Cut & Style", category: "Cuts" },
    { id: "svc-mens", name: "Men's Cut", category: "Cuts" },
  ],
  stylists: [
    { id: "st-bridget", firstName: "Bridget", level: "master" },
    { id: "st-nola", firstName: "Nola", level: "senior" },
  ],
};

const answer = (json: unknown, stop = "end_turn") => ({ id: "msg", type: "message", role: "assistant", model: CHAT_MODEL, stop_sequence: null, usage: {}, stop_reason: stop, content: [{ type: "text", text: JSON.stringify(json) }] });
const blank = { intent: "booking", any_stylist: false, any_time: false, later: false, same_as_last_time: false, service_codes: [], stylist_code: null, level: null, when: null, weekday: null, next: false, month: null, day: null, part_of_day: null, after_hour: null, before_hour: null, earliest: false };

function fake(...responses: unknown[]) {
  const requests: Record<string, unknown>[] = [];
  const create = vi.fn(async (params: Record<string, unknown>) => {
    requests.push(structuredClone(params));
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return next;
  });
  return { client: { messages: { create } } as unknown as ClaudeClient, requests };
}

describe("Denise reading the line", () => {
  it("reads services, stylist and when from the salon's own lists", async () => {
    const { client, requests } = fake(answer({ ...blank, service_codes: ["s1", "s2"], stylist_code: "t1", when: "next_week", part_of_day: "afternoon" }));
    const line = "Maria Lopez, balayage + cut with Bridget next week, afternoons";
    const parse = await readBookingRequest(client, maskedLine(line, "Maria Lopez"), MENU);
    expect(parse).toMatchObject({ serviceIds: ["svc-balayage", "svc-womens"], staffId: "st-bridget", when: { kind: "next_week" }, part: "afternoon" });
    // Claude never sees the client's name, and gets codes rather than ids.
    const sent = JSON.stringify(requests[0]);
    expect(sent).not.toContain("Lopez");
    expect(sent).not.toContain("Maria");
    expect(sent).toContain("s1: Balayage (Balayage)");
    expect(sent).not.toContain("svc-balayage");
    expect(requests[0].model).toBe(CHAT_MODEL);

    const r = requestFrom(parse, "Maria Lopez", TUE);
    expect(r).toMatchObject({ clientText: "Maria Lopez", from: "2026-11-02", to: "2026-11-08", part: "afternoon", staffId: "st-bridget", level: null });
  });

  it("reads 'earliest men's cut with anyone'", async () => {
    const { client } = fake(answer({ ...blank, service_codes: ["s3"], when: "soon", earliest: true }));
    const parse = await readBookingRequest(client, "earliest men's cut with anyone", MENU);
    const r = requestFrom(parse, null, TUE);
    expect(r).toMatchObject({ serviceIds: ["svc-mens"], staffId: null, level: null, earliest: true, from: TUE, to: "2026-11-09" });
  });

  it("reads 'same as last time for Zoey' as same as last time, leaving the services to the visit", async () => {
    const { client } = fake(answer({ ...blank, same_as_last_time: true }));
    const r = requestFrom(await readBookingRequest(client, maskedLine("same as last time for Zoey", "Zoey"), MENU), "Zoey", TUE);
    expect(r).toMatchObject({ sameAsLast: true, serviceIds: [], clientText: "Zoey" });
  });

  it("reads a level and an hour", async () => {
    const parse = checkedParse({ ...blank, service_codes: ["s2"], level: "senior", when: "weekday", weekday: 4, after_hour: 15 }, MENU);
    expect(parse).toMatchObject({ level: "senior", when: { kind: "weekday", weekday: 4, next: false }, after: 15 * 60 });
  });

  it("gives up on an answer that isn't the shape, and without her", async () => {
    expect(checkedParse({ ...blank, service_codes: ["s99"] }, MENU)).toBeNull();
    expect(checkedParse({ ...blank, stylist_code: "t9" }, MENU)).toBeNull();
    expect(checkedParse("nope", MENU)).toBeNull();
    expect(await readBookingRequest(null, "a cut", MENU)).toBeNull();
    const { client } = fake(answer(blank, "max_tokens"));
    expect(await readBookingRequest(client, "a cut", MENU)).toBeNull();
    const failing = fake(new Error("overloaded"));
    const onError = vi.fn();
    expect(await readBookingRequest(failing.client, "a cut", MENU, null, onError)).toBeNull();
    expect(onError).toHaveBeenCalledOnce();
    // Without her reading, the fields start empty for the next two weeks.
    expect(requestFrom(null, "Zoey", TUE)).toMatchObject({ serviceIds: [], from: TUE, to: "2026-11-09", clientText: "Zoey" });
  });
});

// A booking request on screen, for the follow-ups.
const onScreen = (patch: Partial<PhoneRequest> = {}): PhoneRequest => ({
  clientText: "Maria",
  sameAsLast: false,
  serviceIds: ["svc-balayage"],
  staffId: "st-bridget",
  level: null,
  from: "2026-10-29",
  to: "2026-10-29",
  part: "morning",
  after: null,
  before: null,
  earliest: false,
  ...patch,
});
const change = (patch: Partial<BookingParse>): BookingParse => ({
  intent: "change",
  sameAsLast: false,
  serviceIds: [],
  staffId: null,
  level: null,
  anyStylist: false,
  when: null,
  part: null,
  after: null,
  before: null,
  anyTime: false,
  earliest: false,
  later: false,
  ...patch,
});

describe("follow-ups change only what they say", () => {
  it("'what about Friday?' moves the day and keeps the rest", () => {
    const r = applyChange(onScreen(), change({ when: { kind: "weekday", weekday: 5, next: false } }), TUE);
    expect(r).toMatchObject({ from: "2026-10-30", to: "2026-10-30", staffId: "st-bridget", part: "morning", serviceIds: ["svc-balayage"] });
  });

  it("'with Nola instead?' changes the stylist, 'anyone is fine' drops it", () => {
    expect(applyChange(onScreen(), change({ staffId: "st-nola" }), TUE)).toMatchObject({ staffId: "st-nola", level: null, part: "morning" });
    expect(applyChange(onScreen(), change({ anyStylist: true }), TUE)).toMatchObject({ staffId: null, level: null });
    expect(applyChange(onScreen(), change({ level: "senior" }), TUE)).toMatchObject({ staffId: null, level: "senior" });
  });

  it("'any time that day' drops the time of day; 'afternoons' replaces it", () => {
    expect(applyChange(onScreen(), change({ anyTime: true }), TUE)).toMatchObject({ part: null, after: null, before: null });
    expect(applyChange(onScreen(), change({ part: "afternoon" }), TUE)).toMatchObject({ part: "afternoon" });
  });

  it("'make it a gloss' changes the service", () => {
    expect(applyChange(onScreen(), change({ serviceIds: ["svc-womens"] }), TUE).serviceIds).toEqual(["svc-womens"]);
  });

  it("reads a change only when there's a request on screen", async () => {
    const { client, requests } = fake(answer({ ...blank, intent: "change", later: true }), answer({ ...blank, intent: "change", later: true }));
    expect(await readBookingRequest(client, "anything later?", MENU, onScreen())).toMatchObject({ intent: "change", later: true });
    // Denise is told what's on screen, in codes.
    expect(JSON.stringify(requests[0])).toContain("s1");
    expect(await readBookingRequest(client, "anything later?", MENU, null)).toMatchObject({ intent: "booking" });
  });
});

describe("'anything later?'", () => {
  const STYLISTS = [{ id: "bridget", firstName: "Bridget", level: "master" as const }];
  it("only offers times after the latest one shown", () => {
    const c = ctx();
    const r: PhoneRequest = { ...onScreen(), serviceIds: ["cut"], staffId: "bridget", from: TUE, to: TUE, part: null };
    const deps = { stylists: STYLISTS, timingOf: (s: string, v: string) => timingFor(c, s, v), habits: { usualStaffId: null, usualWeekday: null, usualPart: null }, now: EARLY };
    const first = phoneTimes(c, { ...r, earliest: true }, deps);
    const latest = Math.max(...first.options.map((o) => o.lines[0].startMinute));
    const later = phoneTimes(c, { ...r, earliest: true }, { ...deps, laterThan: { date: TUE, minute: latest } });
    expect(later.options.length).toBeGreaterThan(0);
    expect(later.options.every((o) => o.lines[0].startMinute > latest)).toBe(true);
  });
});

describe("without Denise, our code starts the form", () => {
  it("guesses the stylist, service, weekday and part of the day", () => {
    const r = guessRequest("John Williams wants a balayage with Bridget on a Thursday morning", MENU, "John Williams", TUE);
    expect(r).toMatchObject({ clientText: "John Williams", serviceIds: ["svc-balayage"], staffId: "st-bridget", from: "2026-10-29", to: "2026-10-29", part: "morning" });
    expect(guessRequest("earliest men's cut next week", MENU, null, TUE)).toMatchObject({ serviceIds: ["svc-mens"], earliest: true, from: "2026-11-02" });
  });
});

const JOHN_A: ClientMatch = { id: "c-john-a", name: "John Williams", phone: "(312) 555-0101", allergies: null, lastVisit: "Sep 2" };
const JOHN_B: ClientMatch = { id: "c-john-b", name: "John Williams", phone: "(312) 555-0199", allergies: null, lastVisit: null };
const ZOEY: ClientMatch = { id: "c-zoey", name: "Zoey Park", phone: null, allergies: "Latex", lastVisit: "Oct 1" };

const slot = (date: string, minute: number, staffId = "st-bridget"): BookingSlot => ({
  date,
  when: `${date} at ${minute}`,
  what: "Balayage with Bridget",
  reason: "Her usual day",
  priceCents: 22000,
  lines: [{ serviceId: "svc-balayage", staffId, startMinute: minute, minutes: 155, usual: false, priceCents: 22000 }],
});

// Fake database: who's on file and the times found, with what was asked.
function chatDeps(read: BookingParse | null, found: Partial<TimesFound> = {}, clients: ClientMatch[] = [JOHN_A, JOHN_B, ZOEY]) {
  const asked: { request: PhoneRequest; clientId: string | null; laterThan: unknown }[] = [];
  const deps: BookingDeps = {
    today: TUE,
    menu: MENU,
    read: async () => read,
    findClients: async (text) => clients.filter((c) => text.toLowerCase().split(/\s+/).every((w) => c.name.toLowerCase().includes(w) || (c.phone ?? "").includes(w))),
    clientById: async (id) => clients.find((c) => c.id === id) ?? null,
    lastVisit: async (id) => (id === ZOEY.id ? { serviceIds: ["svc-womens"], staffId: "st-nola", text: "Women's Cut & Style with Nola on Oct 1" } : null),
    alerts: async (id) => (id === ZOEY.id ? { allergies: "Latex", card: "none", repeatNoShow: true, policyNote: null, last: null } : { allergies: null, card: "on_file", repeatNoShow: false, policyNote: null, last: null }),
    times: async (request, clientId, laterThan) => {
      asked.push({ request, clientId, laterThan });
      return { options: [], otherDays: [], sameLevel: [], searched: "on Thu, Oct 29, mornings", lengths: null, ...found };
    },
  };
  return { deps, asked };
}
const parsed = (patch: Partial<BookingParse>): BookingParse => ({ ...change(patch), intent: "booking", ...patch });

describe("booking in Denise's chat", () => {
  it("leaves questions to Ask Denise", async () => {
    expect(mightBeBooking("How do I sell a gift card?", MENU, false)).toBe(false);
    expect(mightBeBooking("When's her next visit?", MENU, false)).toBe(false);
    expect(mightBeBooking("John Williams wants a balayage on Thursday", MENU, false)).toBe(true);
    expect(mightBeBooking("anything later?", MENU, true)).toBe(true);
    const { deps } = chatDeps(parsed({ intent: "other" }));
    expect(await bookingTurn("Book Zoey's patch test reminder", null, null, deps)).toBeNull();
  });

  it("finds the client and shows the best times, with their alerts", async () => {
    const { deps, asked } = chatDeps(parsed({ serviceIds: ["svc-balayage"], staffId: "st-bridget", when: { kind: "weekday", weekday: 4, next: false }, part: "morning" }), { options: [slot("2026-10-29", 600)] });
    const reply = await bookingTurn("Zoey Park wants a balayage with Bridget on a Thursday morning", null, null, deps);
    expect(reply?.text).toBe("Here are the best times for Zoey, on Thu, Oct 29, mornings.");
    expect(reply?.card).toMatchObject({ kind: "times", client: { id: ZOEY.id }, alerts: { allergies: "Latex", card: "none", repeatNoShow: true } });
    expect(asked[0]).toMatchObject({ clientId: ZOEY.id, request: { from: "2026-10-29", to: "2026-10-29", part: "morning", staffId: "st-bridget" } });
  });

  it("offers the closest alternatives and the waitlist when nothing fits", async () => {
    const { deps } = chatDeps(parsed({ serviceIds: ["svc-balayage"], staffId: "st-bridget" }), { otherDays: [slot("2026-11-05", 600)], sameLevel: [slot("2026-10-29", 600, "st-gil")] });
    const reply = await bookingTurn("Zoey Park, balayage with Bridget", null, null, deps);
    expect(reply?.text).toBe("Nothing fits on Thu, Oct 29, mornings. The closest I found are on another day and with another stylist at the same level, or add Zoey to the waitlist.");
    expect(reply?.card).toMatchObject({ kind: "times", options: [], otherDays: [{ date: "2026-11-05" }], sameLevel: [{ lines: [{ staffId: "st-gil" }] }] });
  });

  it("asks which client when two share the name", async () => {
    const { deps, asked } = chatDeps(parsed({ serviceIds: ["svc-mens"] }));
    const reply = await bookingTurn("John Williams wants a men's cut", null, null, deps);
    expect(reply?.text).toBe("I found two clients called John Williams. Which one is it?");
    expect(reply?.card).toMatchObject({ kind: "which_client", matches: [{ id: JOHN_A.id }, { id: JOHN_B.id }], request: { serviceIds: ["svc-mens"] } });
    expect(asked).toEqual([]);
    expect(pickClient("John Williams", [JOHN_A, JOHN_B])).toBeNull();
    expect(pickClient("Zoey", [ZOEY, { ...JOHN_A, name: "Zoeya Grant" }])?.id).toBe(ZOEY.id);
  });

  it("offers to add a client who isn't on file", async () => {
    const { deps } = chatDeps(parsed({ serviceIds: ["svc-mens"] }));
    const reply = await bookingTurn("Theo Grant wants a men's cut", null, null, deps);
    expect(reply?.text).toBe("Theo Grant isn't on file yet. Add them as a new client, and I'll find the times.");
    expect(reply?.card).toMatchObject({ kind: "new_client", firstName: "Theo", lastName: "Grant", phone: "" });
  });

  it("books 'same as last time' from their last visit", async () => {
    const { deps, asked } = chatDeps(parsed({ sameAsLast: true }), { options: [slot("2026-10-29", 600, "st-nola")] });
    const reply = await bookingTurn("Zoey, same as last time", null, null, deps);
    expect(reply?.text).toMatch(/^Same as last time: Women's Cut & Style with Nola on Oct 1\. Here are the best times for Zoey/);
    expect(asked[0].request).toMatchObject({ serviceIds: ["svc-womens"], staffId: "st-nola" });
  });

  it("uses the client on the page when no name is typed", async () => {
    const { deps, asked } = chatDeps(parsed({ serviceIds: ["svc-womens"] }), { options: [slot("2026-10-29", 600)] });
    await bookingTurn("book a women's cut on Friday", null, ZOEY.id, deps);
    expect(asked[0].clientId).toBe(ZOEY.id);
  });

  it("follows up on what's on screen: another day, another stylist, later", async () => {
    const first = chatDeps(parsed({ serviceIds: ["svc-balayage"], staffId: "st-bridget" }), { options: [slot("2026-10-29", 600), slot("2026-10-29", 780)] });
    const shown = await bookingTurn("Zoey Park, balayage with Bridget Thursday morning", null, null, first.deps);
    const state = stateOf(shown!.card);
    expect(state).toMatchObject({ clientId: ZOEY.id, shown: [{ minute: 600 }, { minute: 780 }] });

    const friday = chatDeps(change({ when: { kind: "weekday", weekday: 5, next: false } }), { options: [slot("2026-10-30", 600)] });
    await bookingTurn("what about Friday?", state, null, friday.deps);
    expect(friday.asked[0]).toMatchObject({ clientId: ZOEY.id, request: { from: "2026-10-30", staffId: "st-bridget", serviceIds: ["svc-balayage"] } });

    const nola = chatDeps(change({ staffId: "st-nola" }), { options: [slot("2026-10-29", 600, "st-nola")] });
    await bookingTurn("with Nola instead?", state, null, nola.deps);
    expect(nola.asked[0].request).toMatchObject({ staffId: "st-nola", from: state.request.from });

    const later = chatDeps(change({ later: true }), { options: [slot("2026-10-29", 840)] });
    const reply = await bookingTurn("anything later?", state, null, later.deps);
    expect(later.asked[0].laterThan).toEqual({ date: "2026-10-29", minute: 780 });
    expect(reply?.text).toBe("Here are later times for Zoey.");
  });

  it("without Denise, shows the form started from the line", async () => {
    const { deps, asked } = chatDeps(null);
    const reply = await bookingTurn("Zoey Park wants a balayage with Bridget on Thursday", null, null, deps);
    expect(reply?.text).toBe("I can't read requests right now, so fill in what the client wants and I'll find the best times.");
    expect(reply?.card).toMatchObject({ kind: "form", client: { id: ZOEY.id }, request: { serviceIds: ["svc-balayage"], staffId: "st-bridget", from: "2026-10-29" } });
    // The form's lists, without prices.
    expect(reply?.card.kind === "form" && reply.card.menu.services.map((s) => s.id)).toEqual(MENU.services.map((s) => s.id));
    expect(asked).toEqual([]);
    // A question still goes to Ask Denise.
    expect(await bookingTurn("Who's free at 3?", null, null, deps)).toBeNull();
  });
});
