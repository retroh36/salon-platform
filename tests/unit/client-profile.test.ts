import { describe, expect, it } from "vitest";
import { checkoutVisit, clientSince, clientTags, notesEditedText, profileTab, saleTotals, splitVisits, type ProfileVisit } from "@/lib/client-profile";

const NOW = new Date("2026-10-26T16:00:00Z");

function visit(id: string, startsAt: string, status = "completed", hours = 1): ProfileVisit {
  return { id, startsAt, endsAt: new Date(new Date(startsAt).getTime() + hours * 3_600_000).toISOString(), status, services: [], totalCents: null, tipCents: null };
}

describe("splitVisits", () => {
  it("puts upcoming visits first, soonest first, then the past newest first", () => {
    const { upcoming, past } = splitVisits(
      [
        visit("old", "2026-08-01T15:00:00Z"),
        visit("next-week", "2026-11-02T15:00:00Z", "booked"),
        visit("tomorrow", "2026-10-27T15:00:00Z", "confirmed"),
        visit("last-week", "2026-10-19T15:00:00Z"),
        visit("in-chair", "2026-10-26T15:30:00Z", "checked_in"),
        visit("canceled-ahead", "2026-10-30T15:00:00Z", "canceled"),
      ],
      NOW,
    );
    expect(upcoming.map((v) => v.id)).toEqual(["in-chair", "tomorrow", "next-week"]);
    expect(past.map((v) => v.id)).toEqual(["canceled-ahead", "last-week", "old"]);
  });

  it("counts a booked visit that's over as past", () => {
    const { upcoming, past } = splitVisits([visit("missed", "2026-10-26T12:00:00Z", "booked")], NOW);
    expect(upcoming).toEqual([]);
    expect(past.map((v) => v.id)).toEqual(["missed"]);
  });
});

describe("saleTotals", () => {
  it("is what was paid less tips and refunds, leaving out voided sales", () => {
    expect(
      saleTotals([
        { status: "completed", total_cents: 12_000, tip_cents: 2_000, refunded_cents: 1_000 },
        { status: "voided", total_cents: 5_000, tip_cents: 0, refunded_cents: 0 },
      ]),
    ).toEqual({ totalCents: 9_000, tipCents: 2_000 });
  });

  it("is nothing without a sale (or one this person can't see)", () => {
    expect(saleTotals([])).toBeNull();
    expect(saleTotals([{ status: "voided", total_cents: 5_000, tip_cents: 0, refunded_cents: 0 }])).toBeNull();
  });
});

describe("clientTags", () => {
  const base = { firstVisit: "2025-01-10T15:00:00Z", visits: [visit("a", "2025-01-10T15:00:00Z")], spendCents: 50_000, vipCents: 78_000, member: null, noTexts: null };

  it("tags nothing for an ordinary regular", () => {
    expect(clientTags(base, NOW)).toEqual([]);
  });

  it("tags the salon's top spenders VIP, only when spend is known", () => {
    expect(clientTags({ ...base, spendCents: 78_000 }, NOW).map((t) => t.label)).toEqual(["VIP"]);
    expect(clientTags({ ...base, spendCents: 90_000, vipCents: null }, NOW)).toEqual([]);
    expect(clientTags({ ...base, spendCents: null }, NOW)).toEqual([]);
  });

  it("tags a client New before their first visit and for 60 days after", () => {
    expect(clientTags({ ...base, firstVisit: null, visits: [] }, NOW).map((t) => t.label)).toEqual(["New"]);
    expect(clientTags({ ...base, firstVisit: "2026-09-10T15:00:00Z" }, NOW).map((t) => t.label)).toEqual(["New"]);
    expect(clientTags({ ...base, firstVisit: "2026-08-10T15:00:00Z" }, NOW)).toEqual([]);
  });

  it("tags two no-shows in a year as a repeat, with members and no texts", () => {
    const visits = [...base.visits, visit("n1", "2026-03-01T15:00:00Z", "no_show"), visit("n2", "2026-09-01T15:00:00Z", "no_show")];
    expect(clientTags({ ...base, visits, member: "Blowout Club member", noTexts: "No texts — call or email" }, NOW)).toEqual([
      { label: "Blowout Club member", tone: "info" },
      { label: "Repeat no-show", tone: "danger" },
      { label: "No texts — call or email", tone: "warning" },
    ]);
    // One of them over a year ago: not a repeat.
    const older = [...base.visits, visit("n1", "2025-09-01T15:00:00Z", "no_show"), visit("n2", "2026-09-01T15:00:00Z", "no_show")];
    expect(clientTags({ ...base, visits: older }, NOW)).toEqual([]);
  });
});

describe("the rest of the profile", () => {
  it("dates a client from their first visit or when they were added, whichever is earlier", () => {
    expect(clientSince("2026-10-01T00:00:00Z", "2025-05-01T15:00:00Z")).toBe("2025-05-01T15:00:00Z");
    expect(clientSince("2025-01-01T00:00:00Z", "2025-05-01T15:00:00Z")).toBe("2025-01-01T00:00:00Z");
    expect(clientSince("2026-10-01T00:00:00Z", null)).toBe("2026-10-01T00:00:00Z");
  });

  it("checks out today's visit, the one in the chair first", () => {
    const today = (iso: string) => iso.startsWith("2026-10-26");
    const later = visit("later", "2026-10-26T20:00:00Z", "booked");
    const here = visit("here", "2026-10-26T18:00:00Z", "checked_in");
    expect(checkoutVisit([later, here], today)?.id).toBe("here");
    expect(checkoutVisit([later], today)?.id).toBe("later");
    expect(checkoutVisit([visit("tomorrow", "2026-10-27T15:00:00Z", "booked")], today)).toBeNull();
  });

  it("remembers only a real tab", () => {
    expect(profileTab("formulas")).toBe("formulas");
    expect(profileTab("nonsense")).toBe("visits");
    expect(profileTab(undefined)).toBe("visits");
  });

  it("says who edited the notes and when", () => {
    expect(notesEditedText("Olivia Bennett", "Mon, Oct 26", "2:14pm")).toBe("Edited by Olivia Bennett on Mon, Oct 26 at 2:14pm");
    expect(notesEditedText(null, "Mon, Oct 26", "2:14pm")).toBe("Edited on Mon, Oct 26 at 2:14pm");
  });
});
