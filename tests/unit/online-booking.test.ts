import { describe, expect, it } from "vitest";
import { contrast } from "@/lib/color";
import { formatPhone, maskDestination, normalEmail, phoneDigits } from "@/lib/online-booking/contact";
import { canChange } from "@/lib/online-booking/manage";
import { accentReadable, depositFor, describeDeposit, parseBookingSettings, parseServiceOnline, slugify } from "@/lib/online-booking/settings";
import type { BookingSite } from "@/lib/online-booking/site";

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
};

const valid = {
  enabled: "on",
  slug: "maple-and-ash",
  window_days: "60",
  notice_hours: "2",
  allow_new_clients: "on",
  cancel_cutoff_hours: "24",
  cancellation_policy: "Please give us 24 hours.",
  consultation_service_id: "",
  accent_color: "#6B3F2A",
  welcome: "Hello",
};

describe("contact details", () => {
  it("reads US phone numbers as 10 digits", () => {
    expect(phoneDigits("(312) 555-0101")).toBe("3125550101");
    expect(phoneDigits("+1 312 555 0101")).toBe("3125550101");
    expect(phoneDigits("555-0101")).toBeNull();
    expect(formatPhone("3125550101")).toBe("(312) 555-0101");
  });

  it("checks and lowercases emails", () => {
    expect(normalEmail("  Emma@Example.COM ")).toBe("emma@example.com");
    expect(normalEmail("not-an-email")).toBeNull();
  });

  it("masks where a code went", () => {
    expect(maskDestination("sms", "3125550101")).toBe("•••-•••-0101");
    expect(maskDestination("email", "emma@example.com")).toBe("e•••@example.com");
  });
});

describe("deposits", () => {
  it("are a fixed amount (never more than the price) or a percentage", () => {
    expect(depositFor("fixed", 5000, 15000)).toBe(5000);
    expect(depositFor("fixed", 5000, 3000)).toBe(3000);
    expect(depositFor("percent", 25, 28500)).toBe(7125);
    expect(depositFor("none", 0, 28500)).toBe(0);
    expect(describeDeposit("fixed", 5000)).toBe("$50 deposit");
    expect(describeDeposit("fixed", 2550)).toBe("$25.50 deposit");
    expect(describeDeposit("percent", 25)).toBe("25% deposit");
    expect(describeDeposit("none", 0)).toBeNull();
  });
});

describe("booking site settings", () => {
  it("parses the rules, with notice in hours stored as minutes", () => {
    const result = parseBookingSettings(form(valid));
    expect(result).toEqual({
      ok: true,
      value: {
        enabled: true,
        slug: "maple-and-ash",
        window_days: 60,
        notice_minutes: 120,
        allow_new_clients: true,
        cancel_cutoff_hours: 24,
        cancellation_policy: "Please give us 24 hours.",
        consultation_service_id: null,
        accent_color: "#6b3f2a",
        welcome: "Hello",
      },
    });
    // Unchecked boxes aren't sent at all.
    const data = form(valid);
    data.delete("enabled");
    data.delete("allow_new_clients");
    expect(parseBookingSettings(data)).toMatchObject({ ok: true, value: { enabled: false, allow_new_clients: false } });
  });

  it("reports every problem", () => {
    const result = parseBookingSettings(form({ ...valid, slug: "Maple & Ash", window_days: "0", notice_hours: "x", cancel_cutoff_hours: "500", accent_color: "#f5f0eb" }));
    expect(!result.ok && result.errors).toEqual({
      slug: "Use 3 to 60 lowercase letters, numbers and single hyphens.",
      window_days: "Enter 1 to 365 days.",
      notice_minutes: "Enter 0 to 168 hours.",
      cancel_cutoff_hours: "Enter 0 to 168 hours.",
      accent_color: "Choose a darker color: white text on it must be easy to read.",
    });
  });

  it("only takes colors white text is readable on (WCAG AA)", () => {
    expect(accentReadable("#17273b")).toBe(true);
    expect(accentReadable("#6b3f2a")).toBe(true);
    expect(accentReadable("#e2733d")).toBe(false);
    expect(accentReadable("navy")).toBe(false);
    expect(contrast("#ffffff", "#767676")).toBeCloseTo(4.54, 1);
  });

  it("makes a booking address from the salon's name", () => {
    expect(slugify("Maple & Ash Hair Studio")).toBe("maple-and-ash-hair-studio");
    expect(slugify("  Café Noir!! ")).toBe("cafe-noir");
  });

  it("parses each service's online mode and deposit", () => {
    expect(parseServiceOnline("bookable", "none", "")).toEqual({ ok: true, value: { online_booking: "bookable", deposit_kind: "none", deposit_amount: 0 } });
    expect(parseServiceOnline("consultation", "fixed", "50")).toEqual({ ok: true, value: { online_booking: "consultation", deposit_kind: "fixed", deposit_amount: 5000 } });
    expect(parseServiceOnline("bookable", "percent", "25%")).toEqual({ ok: true, value: { online_booking: "bookable", deposit_kind: "percent", deposit_amount: 25 } });
    expect(parseServiceOnline("bookable", "percent", "150")).toEqual({ ok: false, error: "Enter a percentage from 1 to 100." });
    expect(parseServiceOnline("bookable", "fixed", "0")).toEqual({ ok: false, error: "Enter a deposit like 50." });
    expect(parseServiceOnline("sometimes", "none", "")).toEqual({ ok: false, error: "Choose how it's booked online." });
  });
});

describe("changing a booking online", () => {
  const site = { settings: { cancelCutoffHours: 24 } } as BookingSite;
  const now = new Date("2026-11-03T15:00:00Z");
  it("is allowed until the salon's cutoff, for visits that haven't started", () => {
    expect(canChange(site, { status: "booked", start: new Date("2026-11-04T15:00:00Z") }, now)).toBe(true);
    expect(canChange(site, { status: "confirmed", start: new Date("2026-11-04T14:59:00Z") }, now)).toBe(false);
    expect(canChange(site, { status: "canceled", start: new Date("2026-11-10T15:00:00Z") }, now)).toBe(false);
    expect(canChange(site, { status: "checked_in", start: new Date("2026-11-10T15:00:00Z") }, now)).toBe(false);
  });
});
