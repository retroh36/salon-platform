import { describe, expect, it } from "vitest";
import {
  cancelFee,
  cardRequired,
  DEFAULT_POLICY,
  depositNeeded,
  feeFor,
  isClientCancel,
  parsePolicyForm,
  policyText,
  repeatOffenderNote,
  standingOf,
  strikesSince,
  visitTerms,
  type PolicySettings,
} from "@/lib/policy";
import { cardShare, policySummary, repeatOffenders, type ReportFee } from "@/lib/policy-report";

const policy: PolicySettings = {
  ...DEFAULT_POLICY,
  windowHours: 48,
  lateCancel: { kind: "fixed", amount: 4000 },
  noShow: { kind: "percent", amount: 50 },
  repeatAction: "deposit",
};
const HOUR = 3600_000;
const start = new Date("2026-11-10T15:00:00Z");

describe("the policy's fees", () => {
  it("works out each kind of fee, a fixed one never more than the visit", () => {
    expect(feeFor({ kind: "fixed", amount: 4000 }, 12000, 0)).toBe(4000);
    expect(feeFor({ kind: "fixed", amount: 4000 }, 2500, 0)).toBe(2500);
    expect(feeFor({ kind: "percent", amount: 50 }, 12345, 0)).toBe(6173);
    expect(feeFor({ kind: "deposit", amount: 0 }, 12000, 3000)).toBe(3000);
    expect(feeFor({ kind: "none", amount: 0 }, 12000, 3000)).toBe(0);
  });

  it("takes the strictest rule of the salon and every stylist on the visit, and never less than the deposit", () => {
    const gil = { staffId: "gil", windowHours: 72, lateCancel: null, noShow: { kind: "fixed" as const, amount: 8000 } };
    expect(visitTerms(policy, [gil], 12000)).toEqual({ windowHours: 72, lateCancelCents: 4000, noShowCents: 8000, longHoldDays: null });
    expect(visitTerms(policy, [], 12000)).toMatchObject({ windowHours: 48, noShowCents: 6000 });
    expect(visitTerms(policy, [], 12000, 7000)).toMatchObject({ lateCancelCents: 7000, noShowCents: 7000 });
  });

  it("charges a late cancel only inside the window, and only when the client canceled", () => {
    const terms = visitTerms(policy, [], 12000);
    const visit = { startsAt: start, bookedAt: new Date(start.getTime() - 30 * 24 * HOUR), depositPaidCents: 0 };
    expect(cancelFee(terms, visit, new Date(start.getTime() - 12 * HOUR), "Client canceled")).toEqual({ late: true, feeCents: 4000 });
    expect(cancelFee(terms, visit, new Date(start.getTime() - 12 * HOUR), "Client is sick: flu")).toEqual({ late: true, feeCents: 4000 });
    expect(cancelFee(terms, visit, new Date(start.getTime() - 49 * HOUR), "Client canceled")).toEqual({ late: false, feeCents: 0 });
    expect(cancelFee(terms, visit, new Date(start.getTime() - 2 * HOUR), "Stylist unavailable")).toEqual({ late: false, feeCents: 0 });
    expect(isClientCancel("Canceled online by the client")).toBe(true);
    expect(isClientCancel("Client rescheduled")).toBe(false);
  });

  it("with the long-hold rule, a late cancel on a visit booked recently only keeps the deposit", () => {
    const terms = visitTerms({ ...policy, longHoldDays: 28 }, [], 12000, 2000);
    const late = new Date(start.getTime() - 3 * HOUR);
    expect(cancelFee(terms, { startsAt: start, bookedAt: new Date(start.getTime() - 5 * 24 * HOUR), depositPaidCents: 2000 }, late, "Client canceled")).toEqual({ late: true, feeCents: 2000 });
    expect(cancelFee(terms, { startsAt: start, bookedAt: new Date(start.getTime() - 40 * 24 * HOUR), depositPaidCents: 2000 }, late, "Client canceled")).toEqual({ late: true, feeCents: 4000 });
  });
});

describe("cards and repeat offenders", () => {
  it("asks for a card by the salon's rule, and always from a repeat offender", () => {
    const visit = { serviceIds: ["balayage"], staffIds: ["gil"], newClient: false };
    expect(cardRequired({ ...policy, cardRequired: "off" }, visit)).toBe(false);
    expect(cardRequired({ ...policy, cardRequired: "all" }, visit)).toBe(true);
    expect(cardRequired({ ...policy, cardRequired: "new_clients" }, visit)).toBe(false);
    expect(cardRequired({ ...policy, cardRequired: "new_clients" }, { ...visit, newClient: true })).toBe(true);
    expect(cardRequired({ ...policy, cardRequired: "some", cardServiceIds: ["balayage"] }, visit)).toBe(true);
    expect(cardRequired({ ...policy, cardRequired: "some", cardStaffIds: ["shae"] }, visit)).toBe(false);
    expect(cardRequired({ ...policy, cardRequired: "off" }, { ...visit, repeatOffender: true })).toBe(true);
  });

  it("counts strikes in the window, leaving out waived and voided ones", () => {
    const now = new Date("2026-10-24T12:00:00Z");
    const at = (iso: string, status = "charged") => ({ kind: "no_show" as const, status, createdAt: new Date(iso) });
    const incidents = [at("2026-09-01T00:00:00Z"), at("2026-06-01T00:00:00Z", "no_card"), at("2026-08-01T00:00:00Z", "waived"), at("2026-10-01T00:00:00Z", "voided"), at("2026-03-01T00:00:00Z")];
    expect(strikesSince(incidents, 6, now)).toBe(2);
    expect(standingOf(policy, 2)).toEqual({ strikes: 2, action: "deposit" });
    expect(standingOf(policy, 1)).toEqual({ strikes: 1, action: "off" });
    expect(standingOf({ ...policy, repeatAction: "off" }, 5).action).toBe("off");
  });

  it("asks a repeat offender for a deposit or the whole visit, never less than the service's own deposit", () => {
    expect(depositNeeded(policy, { strikes: 2, action: "deposit" }, 12000)).toBe(6000);
    expect(depositNeeded(policy, { strikes: 3, action: "prepay" }, 12000)).toBe(12000);
    expect(depositNeeded(policy, { strikes: 0, action: "off" }, 12000, 2500)).toBe(2500);
    expect(depositNeeded(policy, { strikes: 2, action: "deposit" }, 4000, 2500)).toBe(2500);
  });

  it("gives Denise's heads-up in our own words", () => {
    expect(repeatOffenderNote("Ava", { strikes: 2, action: "deposit" }, policy, "June", true)).toBe(
      "Heads up: Ava has 2 late cancellations or no-shows since June, so the salon asks for a 50% deposit. Once it's booked, send a deposit link from booking details.",
    );
    expect(repeatOffenderNote("Ava", { strikes: 3, action: "prepay" }, policy, null, false)).toContain("the whole visit up front");
    expect(repeatOffenderNote("Ava", { strikes: 1, action: "off" }, policy, null, false)).toBeNull();
  });
});

describe("the policy in plain language", () => {
  it("says this visit's amounts, the deposit and how the card is used", () => {
    expect(policyText(policy, { visitCents: 12000, depositCents: 3000, salon: "Maple & Ash", extra: "Thank you!" })).toEqual([
      "Please give Maple & Ash at least 2 days' notice if you need to cancel.",
      "Canceling with less notice costs $40.",
      "Not showing up costs 50% of the visit ($60).",
      "Your $30 deposit comes off the bill at your visit. It isn't refunded if you cancel late or don't show up.",
      "Your card is saved securely with the payment provider and only charged under this policy. You'll get a receipt if it is.",
      "Thank you!",
    ]);
  });

  it("checks the settings form", () => {
    const form = (fields: Record<string, string | string[]>) => ({
      get: (k: string) => (Array.isArray(fields[k]) ? (fields[k] as string[])[0] : (fields[k] as string)) ?? null,
      getAll: (k: string) => (Array.isArray(fields[k]) ? (fields[k] as string[]) : fields[k] ? [fields[k] as string] : []),
    });
    const ok = parsePolicyForm(form({ card_required: "all", window_hours: "24", late_kind: "fixed", late_amount: "$25.50", no_show_kind: "percent", no_show_amount: "100%", repeat_action: "prepay" }));
    expect(ok).toMatchObject({ ok: true, value: { cardRequired: "all", windowHours: 24, lateCancel: { kind: "fixed", amount: 2550 }, noShow: { kind: "percent", amount: 100 }, repeatAction: "prepay" } });
    const bad = parsePolicyForm(form({ card_required: "some", window_hours: "0", late_kind: "percent", late_amount: "150", no_show_kind: "none" }));
    expect(bad).toEqual({ ok: false, errors: { cardRequired: "Choose at least one service or stylist.", windowHours: "Enter 1 to 168 hours.", lateCancel: "Enter a percentage from 1 to 100." } });
  });
});

describe("the policy page's numbers", () => {
  const fee = (id: string, clientId: string, status: string, kind: ReportFee["kind"] = "no_show", feeCents = 4000, createdAt = "2026-10-05T00:00:00Z"): ReportFee => ({
    id,
    kind,
    feeCents,
    fromDepositCents: 0,
    status,
    createdAt,
    clientId,
    clientName: clientId.toUpperCase(),
  });

  it("adds up charged, waived, failed and waiting fees, leaving out voided ones", () => {
    const s = policySummary([fee("1", "a", "charged"), fee("2", "a", "charged", "late_cancel", 2500), fee("3", "b", "waived"), fee("4", "c", "failed"), fee("5", "d", "pending"), fee("6", "e", "voided"), fee("7", "f", "no_card")]);
    expect(s).toEqual({
      charged: { count: 2, cents: 6500 },
      waived: { count: 1, cents: 4000 },
      failed: { count: 1, cents: 4000 },
      waiting: { count: 2, cents: 8000 },
      recoveredCents: 6500,
      lateCancels: 1,
      noShows: 5,
    });
  });

  it("lists repeat offenders, most strikes first, waivers not counted", () => {
    const fees = [fee("1", "a", "charged"), fee("2", "a", "failed", "late_cancel", 4000, "2026-10-09T00:00:00Z"), fee("3", "b", "charged"), fee("4", "b", "waived"), fee("5", "c", "charged"), fee("6", "c", "charged"), fee("7", "c", "no_card")];
    expect(repeatOffenders(fees, 2)).toEqual([
      { clientId: "c", clientName: "C", strikes: 3, lastAt: "2026-10-05T00:00:00Z" },
      { clientId: "a", clientName: "A", strikes: 2, lastAt: "2026-10-09T00:00:00Z" },
    ]);
  });

  it("says how many upcoming bookings have a card on file", () => {
    expect(cardShare([{ clientId: "a" }, { clientId: "b" }, { clientId: null }, { clientId: "a" }], new Set(["a"]))).toEqual({ withCard: 2, total: 4, percent: 50 });
    expect(cardShare([], new Set())).toEqual({ withCard: 0, total: 0, percent: 0 });
  });
});
