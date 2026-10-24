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
  it("tells the client and the stylist about a later time", () => {
    const { notifications, undo } = notificationsFor([change([660, "p"], [680, "p"])]);
    expect(notifications).toEqual([
      {
        template: "time_change",
        clientId: "client-1",
        appointmentId: "appt",
        body: "Hi Grace, it's Maple & Ash. Your appointment today has moved from 11am to 11:20am, still with Priya. Reply or call us if that doesn't work. See you soon!",
      },
      { template: "staff_schedule_change", staffId: "p", appointmentId: "appt", body: "Grace Lewis's Women's Cut & Style has moved from 11am to 11:20am." },
    ]);
    expect(undo.map((n) => n.body)).toEqual([
      "Hi Grace, it's Maple & Ash. Sorry for the mix-up: your appointment today is back at 11am with Priya. See you then!",
      "Grace Lewis's Women's Cut & Style has moved from 11:20am to 11am.",
    ]);
  });

  it("tells both stylists when a client changes stylist", () => {
    const { notifications } = notificationsFor([change([720, "p"], [720, "e"])]);
    expect(notifications.map((n) => n.body)).toEqual([
      "Hi Grace, it's Maple & Ash. Your appointment today is still at noon and will be with Ethan. Reply or call us if that doesn't work. See you soon!",
      "Grace Lewis's Women's Cut & Style at noon has moved to Ethan at noon.",
      "Grace Lewis's Women's Cut & Style at noon is now with you (it was with Priya).",
    ]);
    expect(notifications.map((n) => n.staffId ?? n.clientId)).toEqual(["client-1", "p", "e"]);
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
    salon: "Maple & Ash",
    service: "Balayage",
    today: "2026-10-27",
    from: { date: "2026-10-27", minute: 600, staffId: "gil", staffFirstName: "Gil" },
    to: { date: "2026-10-29", minute: 840, staffId: "gil", staffFirstName: "Gil" },
  };

  it("says the new day and time to the client and the stylist", () => {
    expect(moveNotices(base)).toEqual([
      { template: "visit_moved", clientId: "c1", body: "Hi Ava, it's Maple & Ash. Your appointment has moved from today at 10am to Thu, Oct 29 at 2pm, still with Gil. Reply or call us if that doesn't work. See you soon!" },
      { template: "staff_visit_moved", staffId: "gil", body: "Ava Chen's Balayage has moved from today at 10am to Thu, Oct 29 at 2pm." },
    ]);
  });

  it("on the same day, the time; with a new stylist, both stylists", () => {
    const n = moveNotices({ ...base, today: "2026-10-20", from: { ...base.from, date: "2026-10-29" }, to: { ...base.to, staffId: "sam", staffFirstName: "Sam" } });
    expect(n.map((x) => x.body)).toEqual([
      "Hi Ava, it's Maple & Ash. Your appointment on Thu, Oct 29 has moved from 10am to 2pm and will be with Sam. Reply or call us if that doesn't work. See you soon!",
      "Ava Chen's Balayage on Thu, Oct 29 at 10am has moved to Sam, Thu, Oct 29 at 2pm.",
      "Ava Chen's Balayage on Thu, Oct 29 at 2pm is now with you (it was with Gil).",
    ]);
  });

  it("nothing when only the chair changed", () => {
    expect(moveNotices({ ...base, to: base.from })).toEqual([]);
  });
});
