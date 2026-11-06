// The booking rules follow the working role of the shift a stylist is on:
// its services (none listed: all of theirs) and whether it's booked online.
import { describe, expect, it } from "vitest";
import { checkItem, fromLocal, parseTime, type BookingContext, type BookingStaff } from "@/lib/scheduling";
import { planVisitAt } from "@/lib/scheduling/online";

const CHICAGO = "America/Chicago";
const TUESDAY = "2026-10-27";
const at = (time: string) => fromLocal(TUESDAY, parseTime(time)!, CHICAGO)!;
const service = (id: string, minutes: number) => ({ id, activeMinutes: minutes, processingMinutes: 0, finishingMinutes: 0, archived: false });

// Mia: Wash House 9–1 (blowouts only, not online), Beauty Bar 2–6 (no
// services listed: all hers, online).
const mia: BookingStaff = {
  id: "mia",
  isActive: true,
  schedule: {
    weekly: {
      2: [
        { start: 540, end: 780, role: "wash" },
        { start: 840, end: 1080, role: "bar" },
      ],
    },
    overrides: {},
    timeOff: [],
  },
  serviceIds: new Set(["blowout", "cut"]),
};

const context = (roles?: BookingContext["roles"]): BookingContext => ({
  location: { timeZone: CHICAGO, weekly: { 2: [{ start: 540, end: 1140 }] } },
  services: new Map([service("blowout", 45), service("cut", 60)].map((s) => [s.id, s])),
  staff: new Map([["mia", mia]]),
  resources: new Map(),
  booked: [],
  roles,
});

const ROLES = new Map([
  ["wash", { name: "Wash House", online: false, serviceIds: new Set(["blowout"]) }],
  ["bar", { name: "Beauty Bar", online: true, serviceIds: new Set<string>() }],
]);
const withRoles = context(ROLES);

describe("booking in a working role", () => {
  it("takes only the role's services", () => {
    expect(checkItem(withRoles, { serviceId: "blowout", staffId: "mia", start: at("10:00") }).valid).toBe(true);
    const cut = checkItem(withRoles, { serviceId: "cut", staffId: "mia", start: at("10:00") });
    expect(cut.valid ? [] : cut.problems).toEqual([{ code: "role_service", role: "Wash House" }]);
    // A role with no services listed takes all of theirs.
    expect(checkItem(withRoles, { serviceId: "cut", staffId: "mia", start: at("15:00") }).valid).toBe(true);
  });

  it("keeps a role that isn't online off the booking site, not the desk", () => {
    const online = checkItem(withRoles, { serviceId: "blowout", staffId: "mia", start: at("10:00") }, [], { online: true });
    expect(online.valid ? [] : online.problems).toEqual([{ code: "role_not_online", role: "Wash House" }]);
    const request = { serviceIds: ["blowout"], staffId: null, stylistIds: ["mia"] };
    expect(planVisitAt(withRoles, request, at("10:00"))).toBeNull();
    expect(planVisitAt(withRoles, request, at("15:00"))).toHaveLength(1);
  });

  it("treats a role that isn't in use (archived) as no role", () => {
    const archived = context(new Map([["bar", ROLES.get("bar")!]]));
    expect(checkItem(archived, { serviceId: "cut", staffId: "mia", start: at("10:00") }).valid).toBe(true);
    expect(planVisitAt(archived, { serviceIds: ["cut"], staffId: "mia", stylistIds: ["mia"] }, at("10:00"))).toHaveLength(1);
  });
});
