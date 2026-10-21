import { describe, expect, it } from "vitest";
import { notificationsFor, type VisitChange } from "@/lib/notifications";

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
