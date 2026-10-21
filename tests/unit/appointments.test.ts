import { describe, expect, it } from "vitest";
import {
  ACTION_STATUS,
  allowedActions,
  canBook,
  canEditNotes,
  cancelReason,
  isEditable,
  priceFor,
  STATUS_LABELS,
  visitSummary,
  type AppointmentStatus,
} from "@/lib/appointments";

const STATUSES = Object.keys(STATUS_LABELS) as AppointmentStatus[];

describe("status changes", () => {
  it("allows checking in, canceling and no-shows before the visit", () => {
    expect(allowedActions("booked")).toEqual(["check_in", "cancel", "no_show"]);
    expect(allowedActions("confirmed")).toEqual(["check_in", "cancel", "no_show"]);
  });

  it("only checks out a client who's checked in", () => {
    expect(allowedActions("checked_in")).toEqual(["check_out", "cancel"]);
    for (const s of STATUSES.filter((s) => s !== "checked_in")) expect(allowedActions(s)).not.toContain("check_out");
  });

  it("treats checked out, canceled and no-show as final", () => {
    for (const s of ["completed", "canceled", "no_show"] as const) {
      expect(allowedActions(s)).toEqual([]);
      expect(isEditable(s)).toBe(false);
    }
    for (const s of ["booked", "confirmed", "checked_in"] as const) expect(isEditable(s)).toBe(true);
  });

  it("maps each action to a status", () => {
    expect(ACTION_STATUS).toEqual({ check_in: "checked_in", check_out: "completed", cancel: "canceled", no_show: "no_show" });
  });
});

describe("who can do what", () => {
  it("lets front of house book; stylists edit notes on their own visits", () => {
    expect(["owner", "manager", "front_desk"].every((r) => canBook(r as "owner"))).toBe(true);
    expect(canBook("stylist")).toBe(false);
    expect(canEditNotes("stylist", "me", ["me", "other"])).toBe(true);
    expect(canEditNotes("stylist", "me", ["other"])).toBe(false);
    expect(canEditNotes("front_desk", "me", ["other"])).toBe(true);
  });
});

describe("cancel reasons", () => {
  it("combines a preset with optional detail", () => {
    expect(cancelReason("Client canceled", "")).toBe("Client canceled");
    expect(cancelReason("Client canceled", "  flight delayed ")).toBe("Client canceled: flight delayed");
  });

  it("needs detail for Other, and a known preset", () => {
    expect(cancelReason("Other", "")).toBeNull();
    expect(cancelReason("Other", "Power cut")).toBe("Power cut");
    expect(cancelReason("Because", "x")).toBeNull();
  });

  it("caps the detail", () => {
    expect(cancelReason("Other", "x".repeat(400))).toHaveLength(300);
  });
});

describe("prices and totals", () => {
  it("uses the stylist's price, else the menu price", () => {
    expect(priceFor(8500, 9500)).toBe(9500);
    expect(priceFor(8500, null)).toBe(8500);
    expect(priceFor(8500, 0)).toBe(0);
  });

  it("sums a visit from the first start to the last end", () => {
    expect(
      visitSummary([
        { startMinute: 600, minutes: 105, priceCents: 15000 },
        { startMinute: 705, minutes: 45, priceCents: 4500 },
      ]),
    ).toEqual({ start: 600, end: 750, minutes: 150, priceCents: 19500 });
    // A service inside another's processing doesn't add time.
    expect(visitSummary([{ startMinute: 600, minutes: 105, priceCents: 1 }, { startMinute: 645, minutes: 15, priceCents: 1 }])?.minutes).toBe(105);
    expect(visitSummary([])).toBeNull();
  });
});
