import { describe, expect, it } from "vitest";
import { briefItemKey, creditText, withoutDismissed, type BriefFacts } from "@/lib/denise/brief";
import { likelyOverruns } from "@/lib/denise/risk";
import { fromLocal, parseTime, type BookedItem, type BookingContext } from "@/lib/scheduling";
import { findConflicts } from "@/lib/scheduling/resolve";

const TZ = "America/Chicago";
const DAY = "2026-10-27";
const at = (t: string) => fromLocal(DAY, parseTime(t)!, TZ)!;
const BALAYAGE = { id: "balayage", activeMinutes: 75, processingMinutes: 40, finishingMinutes: 40, archived: false };
const CUT = { id: "cut", activeMinutes: 60, processingMinutes: 0, finishingMinutes: 0, archived: false };
const shift = { 2: [{ start: 9 * 60, end: 18 * 60 }] };

const item = (id: string, svc: typeof CUT, staffId: string, time: string): BookedItem => ({
  id,
  appointmentId: `a-${id}`,
  serviceId: svc.id,
  staffId,
  resourceId: null,
  start: at(time),
  activeMinutes: svc.activeMinutes,
  processingMinutes: svc.processingMinutes,
  finishingMinutes: svc.finishingMinutes,
});

function ctx(booked: BookedItem[]): BookingContext {
  return {
    location: { timeZone: TZ, weekly: shift },
    services: new Map([BALAYAGE, CUT].map((s) => [s.id, s])),
    staff: new Map(["bridget", "gil"].map((id) => [id, { id, isActive: true, schedule: { weekly: shift, overrides: {}, timeOff: [] }, serviceIds: new Set(["balayage", "cut"]) }])),
    resources: new Map(),
    booked,
  };
}

const learned = new Map([
  ["bridget:balayage", { medianMinutes: 181, trusted: true }],
  ["gil:cut", { medianMinutes: 64, trusted: true }],
  ["gil:balayage", { medianMinutes: 200, trusted: false }],
]);

describe("the risk check", () => {
  const morning = new Date(at("8:00"));

  it("expects an overrun when the stylist usually takes 10+ minutes longer than booked", () => {
    const booked = [item("b", BALAYAGE, "bridget", "9:00"), item("c", CUT, "gil", "9:00"), item("u", BALAYAGE, "gil", "12:00")];
    const statuses = new Map(booked.map((b) => [b.appointmentId!, "confirmed" as const]));
    // Bridget: 181 against 155 booked, rounded up to 30. Gil's cut is only 4
    // over; his balayage figure isn't trusted yet.
    expect(likelyOverruns(ctx(booked), statuses, learned, morning)).toEqual([{ id: "b", kind: "likely_overrun", itemId: "b", minutes: 30 }]);
  });

  it("skips visits that have started, are over, or were already reported", () => {
    const booked = [item("b", BALAYAGE, "bridget", "9:00")];
    expect(likelyOverruns(ctx(booked), new Map([["a-b", "checked_in" as const]]), learned, morning)).toEqual([]);
    expect(likelyOverruns(ctx(booked), new Map([["a-b", "booked" as const]]), learned, new Date(at("9:30")))).toEqual([]);
    expect(likelyOverruns(ctx(booked), new Map([["a-b", "booked" as const]]), learned, morning, [{ id: "r", kind: "overrun", itemId: "b", minutes: 15 }])).toEqual([]);
  });

  it("turns into a conflict with fixes only when it would push into another client", () => {
    const alone = [item("b", BALAYAGE, "bridget", "9:00")];
    const statuses = new Map([["a-b", "confirmed" as const], ["a-next", "confirmed" as const]]);
    const quiet = likelyOverruns(ctx(alone), statuses, learned, morning);
    expect(findConflicts({ ctx: ctx(alone), statuses, disruptions: quiet, now: morning })).toEqual([]);

    const busy = [...alone, item("next", CUT, "bridget", "11:35")];
    const risks = likelyOverruns(ctx(busy), statuses, learned, morning);
    const [conflict] = findConflicts({ ctx: ctx(busy), statuses, disruptions: risks, now: morning });
    expect(conflict).toMatchObject({ kind: "likely_overrun", subject: "likely:b", causeItemIds: ["b"], displaced: ["next"] });
    expect(conflict.options.length).toBeGreaterThan(0);
  });
});

describe("the morning brief", () => {
  const facts: BriefFacts = {
    date: DAY,
    visits: 23,
    risks: [{ subject: "likely:b", headline: "Bridget usually takes about 30 minutes longer…", appointmentId: "a-b" }],
    likelyNoShows: [{ appointmentId: "a-e", client: "Emma S.", time: "2pm", noShowPercent: 33, visits: 6 }],
    dueNotBooked: { total: 37, top: [{ clientId: "c-l", client: "Liam B.", overdueDays: 21, usualWeeks: 5 }, { clientId: "c-a", client: "Ava K.", overdueDays: 0, usualWeeks: 6 }] },
    openings: { count: 2, withMatches: 1 },
    lowStock: [{ productId: "p-7n", name: "Goldwell Topchic 7N" }],
    credits: [{ clientId: "c-m", appointmentId: "a-m", client: "Mia R.", packages: ["3 Blowouts left"], giftCardCents: 4000 }],
  };

  it("leaves out what's been dismissed, in every section", () => {
    const keys = new Set(["risk:likely:b", "noshow:a-e", "due:c-l", "stock:p-7n", "credit:c-m", "noshow:someone-else"]);
    const left = withoutDismissed(facts, keys);
    expect(left.risks).toEqual([]);
    expect(left.likelyNoShows).toEqual([]);
    expect(left.dueNotBooked).toEqual({ total: 36, top: [facts.dueNotBooked.top[1]] });
    expect(left.lowStock).toEqual([]);
    expect(left.credits).toEqual([]);
    expect(withoutDismissed(facts, new Set())).toEqual(facts);
  });

  it("keys items by section and what they're about", () => {
    expect(briefItemKey.noShow(facts.likelyNoShows[0])).toBe("noshow:a-e");
    expect(briefItemKey.due(facts.dueNotBooked.top[0])).toBe("due:c-l");
  });

  it("describes credit without the client's name", () => {
    expect(creditText(facts.credits[0])).toBe("3 Blowouts left on a package, $40 on a gift card");
  });
});
