// Appointment reminders: when one is due, and its fixed wording.
import { describe, expect, it } from "vitest";
import { reminderDue, reminderMessage, reminderWhen, stylistsText } from "@/lib/reminders";

const NOW = new Date("2026-11-09T15:00:00Z");
const hoursFromNow = (h: number) => new Date(NOW.getTime() + h * 3_600_000);
const visit = (startsIn: number, bookedAgo = 48, status = "booked") => ({ status, startsAt: hoursFromNow(startsIn), createdAt: hoursFromNow(-bookedAgo) });

describe("reminderDue", () => {
  it("is due from the chosen time before until an hour before", () => {
    expect(reminderDue(visit(24), 24, NOW)).toBe(true);
    expect(reminderDue(visit(25), 24, NOW)).toBe(false);
    expect(reminderDue(visit(3), 24, NOW)).toBe(true);
    expect(reminderDue(visit(0.5), 24, NOW)).toBe(false);
    expect(reminderDue(visit(2), 2, NOW)).toBe(true);
  });

  it("only for visits still booked or confirmed, and not one booked in the last hour", () => {
    expect(reminderDue(visit(20, 48, "confirmed"), 24, NOW)).toBe(true);
    expect(reminderDue(visit(20, 48, "canceled"), 24, NOW)).toBe(false);
    expect(reminderDue(visit(20, 48, "checked_in"), 24, NOW)).toBe(false);
    expect(reminderDue(visit(20, 0.5), 24, NOW)).toBe(false);
    expect(reminderDue(visit(20, 1), 24, NOW)).toBe(true);
  });
});

describe("the message", () => {
  it("says when as today, tomorrow or the day", () => {
    expect(reminderWhen("2026-11-09", 14 * 60 + 15, "2026-11-09")).toBe("today at 2:15pm");
    expect(reminderWhen("2026-11-10", 14 * 60 + 15, "2026-11-09")).toBe("tomorrow, Tue, Nov 10 at 2:15pm");
    expect(reminderWhen("2026-11-12", 9 * 60, "2026-11-09")).toBe("Thu, Nov 12 at 9am");
  });

  it("names each stylist once", () => {
    expect(stylistsText(["Bridget", "Bridget"])).toBe("Bridget");
    expect(stylistsText(["Bridget", "Shae"])).toBe("Bridget and Shae");
    expect(stylistsText(["Bridget", "Shae", "Gil"])).toBe("Bridget, Shae and Gil");
  });

  it("is fixed words, with the link to change it when the salon books online, else its phone", () => {
    const base = { salon: "Maple & Ash", firstName: "Ava", when: "tomorrow, Tue, Nov 10 at 2:15pm", stylists: "Bridget" };
    expect(reminderMessage({ ...base, manageUrl: "https://x.test/m/abc", phone: "(312) 555-0100" })).toEqual({
      subject: "Your visit at Maple & Ash",
      body: "Maple & Ash: Hi Ava, a reminder of your visit tomorrow, Tue, Nov 10 at 2:15pm with Bridget. View, change or cancel: https://x.test/m/abc",
    });
    expect(reminderMessage({ ...base, manageUrl: null, phone: "(312) 555-0100" }).body).toBe("Maple & Ash: Hi Ava, a reminder of your visit tomorrow, Tue, Nov 10 at 2:15pm with Bridget. To change it, call (312) 555-0100.");
    expect(reminderMessage({ ...base, manageUrl: null, phone: null }).body).not.toMatch(/!/);
  });
});
