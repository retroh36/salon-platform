import { describe, expect, it } from "vitest";
import { moveNotices, notificationsFor, type VisitChange } from "@/lib/notifications";

const change = (from: [number, string], to: [number, string], client = true): VisitChange => ({
  appointmentId: "appt",
  client: client ? { id: "client-1", firstName: "Grace", fullName: "Grace Lewis" } : null,
  salon: "Maple & Ash",
  service: "Women's Cut & Style",
  from: { minute: from[0], staffId: from[1], staffFirstName: from[1] === "p" ? "Priya" : "Ethan" },
  to: { minute: to[0], staffId: to[1], staffFirstName: to[1] === "p" ? "Priya" : "Ethan" },
});

describe("notifications for a changed visit", () => {
  // Never the client: staff send them their message after Apply.
  it("tells the stylist about a later time, and never the client", () => {
    const { notifications, undo } = notificationsFor([change([660, "p"], [680, "p"])]);
    expect(notifications).toEqual([
      { template: "staff_schedule_change", staffId: "p", appointmentId: "appt", body: "Grace Lewis's Women's Cut & Style has moved from 11am to 11:20am." },
    ]);
    expect(undo.map((n) => n.body)).toEqual(["Grace Lewis's Women's Cut & Style has moved from 11:20am to 11am."]);
    expect([...notifications, ...undo].filter((n) => n.clientId)).toEqual([]);
  });

  it("tells both stylists when a client changes stylist", () => {
    const { notifications } = notificationsFor([change([720, "p"], [720, "e"])]);
    expect(notifications.map((n) => n.body)).toEqual([
      "Grace Lewis's Women's Cut & Style at noon has moved to Ethan at noon.",
      "Grace Lewis's Women's Cut & Style at noon is now with you (it was with Priya).",
    ]);
    expect(notifications.map((n) => n.staffId)).toEqual(["p", "e"]);
  });

  it("sends nothing for a new chair, and nothing to a walk-in", () => {
    expect(notificationsFor([change([660, "p"], [660, "p"])])).toEqual({ notifications: [], undo: [] });
    const walkIn = notificationsFor([change([660, "p"], [690, "p"], false)]);
    expect(walkIn.notifications.map((n) => n.template)).toEqual(["staff_schedule_change"]);
    expect(walkIn.notifications[0].body).toBe("A walk-in's Women's Cut & Style has moved from 11am to 11:30am.");
  });
});

describe("notices when staff move a visit", () => {
  const base = {
    appointmentId: "a1",
    client: { id: "c1", firstName: "Ava", fullName: "Ava Chen" },
    service: "Balayage",
    today: "2026-10-27",
    from: { date: "2026-10-27", minute: 600, staffId: "gil", staffFirstName: "Gil" },
    to: { date: "2026-10-29", minute: 840, staffId: "gil", staffFirstName: "Gil" },
  };

  // Never the client: staff choose to tell them, with Send.
  it("says the new day and time to the stylist, never the client", () => {
    expect(moveNotices(base)).toEqual([{ template: "staff_visit_moved", staffId: "gil", body: "Ava Chen's Balayage has moved from today at 10am to Thu, Oct 29 at 2pm." }]);
  });

  it("on the same day, the time; with a new stylist, both stylists", () => {
    const n = moveNotices({ ...base, today: "2026-10-20", from: { ...base.from, date: "2026-10-29" }, to: { ...base.to, staffId: "sam", staffFirstName: "Sam" } });
    expect(n.map((x) => x.body)).toEqual([
      "Ava Chen's Balayage on Thu, Oct 29 at 10am has moved to Sam, Thu, Oct 29 at 2pm.",
      "Ava Chen's Balayage on Thu, Oct 29 at 2pm is now with you (it was with Gil).",
    ]);
  });

  it("nothing when only the chair changed", () => {
    expect(moveNotices({ ...base, to: base.from })).toEqual([]);
  });
});
