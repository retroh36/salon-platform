import { describe, expect, it } from "vitest";
import {
  automationProblems,
  automationResults,
  birthdayOn,
  canSendAt,
  channelFor,
  DEFAULT_AUTOMATIONS,
  dueFor,
  previewMessage,
  renderTemplate,
  reviewDue,
  suggestAutomations,
  unknownFields,
  withOptOut,
  type ClientFacts,
} from "@/lib/automations";

const NOW = new Date("2026-10-23T17:00:00Z");
const TODAY = "2026-10-23";

const client = (over: Partial<ClientFacts> = {}): ClientFacts => ({
  id: "c1",
  firstName: "Ava",
  phone: "(312) 555-0100",
  email: "ava@example.com",
  smsOptIn: true,
  emailOptIn: true,
  birthMonth: null,
  birthDay: null,
  due: "overdue",
  overdueDays: 9,
  nextDue: "2026-10-14T15:00:00.000Z",
  lastVisit: "2026-09-02T15:00:00.000Z",
  lastVisitOn: null,
  preferredStaffId: null,
  hasUpcoming: false,
  lastMessagedAt: null,
  ...over,
});

describe("templates", () => {
  it("fills in fields and tidies what an empty one leaves", () => {
    expect(renderTemplate("Hi {first_name}, it's {salon}. {offer}", { first_name: "Ava", salon: "Maple & Ash", offer: "" })).toBe("Hi Ava, it's Maple & Ash.");
    expect(renderTemplate("Hello {first_name} !", { first_name: "Bo" })).toBe("Hello Bo!");
    expect(unknownFields("Hi {first_name}, {discount} {booking_link}", "rebook")).toEqual(["discount"]);
    expect(unknownFields("Leave a review: {review_links}", "rebook")).toEqual(["review_links"]);
  });

  it("ends every message with an opt-out", () => {
    expect(withOptOut("Hi", "sms", "https://x/unsubscribe/t")).toBe("Hi\n\nReply STOP or tap https://x/unsubscribe/t to stop these texts.");
    expect(withOptOut("Hi", "email", "https://x/unsubscribe/t")).toBe("Hi\n\nDon't want these emails? Unsubscribe: https://x/unsubscribe/t");
  });

  it("previews a message for a sample client", () => {
    const p = previewMessage({ kind: "rebook", ...DEFAULT_AUTOMATIONS.rebook }, { name: "Maple & Ash", bookingUrl: "https://app.test/book/maple", googleUrl: null, yelpUrl: null }, "sms");
    expect(p.body).toContain("Hi Ava, it's been a little while since your last visit to Maple & Ash.");
    expect(p.body).toContain("https://app.test/book/maple?src=rebook");
    expect(p.body).toContain("Reply STOP");
  });
});

describe("consent and timing", () => {
  it("uses only a channel the client said yes to, the preferred one first", () => {
    const c = { phone: "(312) 555-0100", email: "a@b.co", smsOptIn: true, emailOptIn: true };
    expect(channelFor(c, "sms")).toEqual({ channel: "sms", to: "(312) 555-0100" });
    expect(channelFor(c, "email")).toEqual({ channel: "email", to: "a@b.co" });
    expect(channelFor({ ...c, smsOptIn: false }, "sms")).toEqual({ channel: "email", to: "a@b.co" });
    expect(channelFor({ ...c, emailOptIn: false, phone: null }, "email")).toBeNull();
    expect(channelFor({ ...c, smsOptIn: false, emailOptIn: false }, "sms")).toBeNull();
  });

  it("sends between 9am and 8pm only", () => {
    expect(canSendAt(8 * 60 + 59)).toBe(false);
    expect(canSendAt(9 * 60)).toBe(true);
    expect(canSendAt(19 * 60 + 59)).toBe(true);
    expect(canSendAt(20 * 60)).toBe(false);
  });
});

describe("who's due", () => {
  const settings = (kind: keyof typeof DEFAULT_AUTOMATIONS) => DEFAULT_AUTOMATIONS[kind].settings;

  it("reminds a client past their usual return, once per time they're due", () => {
    expect(dueFor("rebook", client(), settings("rebook"), TODAY, NOW)).toBe("rebook:2026-10-14");
    // Not yet a week past it, something booked, or lapsed (that's win-back).
    expect(dueFor("rebook", client({ overdueDays: 5 }), settings("rebook"), TODAY, NOW)).toBeNull();
    expect(dueFor("rebook", client({ hasUpcoming: true }), settings("rebook"), TODAY, NOW)).toBeNull();
    expect(dueFor("rebook", client({ due: "lapsed" }), settings("rebook"), TODAY, NOW)).toBeNull();
  });

  it("wins back a client away for the set weeks", () => {
    expect(dueFor("win_back", client({ lastVisit: "2026-07-01T15:00:00Z" }), settings("win_back"), TODAY, NOW)).toBe("win_back:2026-07-01");
    expect(dueFor("win_back", client({ lastVisit: "2026-08-15T15:00:00Z" }), settings("win_back"), TODAY, NOW)).toBeNull();
    expect(dueFor("win_back", client({ lastVisit: null }), settings("win_back"), TODAY, NOW)).toBeNull();
  });

  it("counts the weeks away from the salon's date of the visit, keeping the key it always had", () => {
    // 8pm on Fri Jul 31 in Chicago is already Aug 1 in UTC: 12 weeks to the day is Oct 23.
    const evening = client({ lastVisit: "2026-08-01T01:00:00.000Z", lastVisitOn: "2026-07-31" });
    expect(dueFor("win_back", evening, settings("win_back"), TODAY, NOW)).toBe("win_back:2026-08-01");
    expect(dueFor("win_back", { ...evening, lastVisitOn: "2026-08-01" }, settings("win_back"), TODAY, NOW)).toBeNull();
  });

  it("wishes a happy birthday on the day, or days before, once a year (Feb 29 on Feb 28)", () => {
    expect(dueFor("birthday", client({ birthMonth: 10, birthDay: 23 }), settings("birthday"), TODAY, NOW)).toBe("birthday:2026");
    expect(dueFor("birthday", client({ birthMonth: 10, birthDay: 26 }), { ...settings("birthday"), daysBefore: 3 }, TODAY, NOW)).toBe("birthday:2026");
    expect(dueFor("birthday", client({ birthMonth: 10, birthDay: 24 }), settings("birthday"), TODAY, NOW)).toBeNull();
    expect(birthdayOn(2, 29, "2027-02-28")).toBe(true);
    expect(birthdayOn(2, 29, "2028-02-28")).toBe(false);
    expect(birthdayOn(2, 29, "2028-02-29")).toBe(true);
  });

  it("leaves a week between messages to the same client", () => {
    const messaged = client({ lastMessagedAt: "2026-10-19T17:00:00Z", birthMonth: 10, birthDay: 23 });
    expect(dueFor("birthday", messaged, settings("birthday"), TODAY, NOW)).toBeNull();
    expect(dueFor("birthday", { ...messaged, lastMessagedAt: "2026-10-15T17:00:00Z" }, settings("birthday"), TODAY, NOW)).toBe("birthday:2026");
  });

  it("asks for a review hours after checkout, within a day", () => {
    expect(reviewDue("2026-10-23T13:30:00Z", { prefer: "sms", hoursAfter: 3 }, NOW)).toBe(true);
    expect(reviewDue("2026-10-23T15:00:00Z", { prefer: "sms", hoursAfter: 3 }, NOW)).toBe(false);
    expect(reviewDue("2026-10-21T15:00:00Z", { prefer: "sms", hoursAfter: 3 }, NOW)).toBe(false);
  });
});

describe("setting one up", () => {
  const salon = { bookingLive: true, googleUrl: "https://g.page/r/x/review", yelpUrl: null };

  it("needs known fields, a booking site for booking links, and a review link for reviews", () => {
    expect(automationProblems({ kind: "rebook", ...DEFAULT_AUTOMATIONS.rebook }, salon)).toEqual([]);
    expect(automationProblems({ kind: "rebook", ...DEFAULT_AUTOMATIONS.rebook, body: "Hi {name}" }, salon)).toEqual(["These aren't fields this message can use: {name}."]);
    expect(automationProblems({ kind: "rebook", ...DEFAULT_AUTOMATIONS.rebook }, { ...salon, bookingLive: false })).toEqual([
      "Turn on online booking first (Settings → Online booking), or take out {booking_link}.",
    ]);
    expect(automationProblems({ kind: "review", ...DEFAULT_AUTOMATIONS.review }, { ...salon, googleUrl: null })).toEqual(["Add your Google or Yelp review link."]);
    expect(automationProblems({ kind: "win_back", ...DEFAULT_AUTOMATIONS.win_back, settings: { prefer: "email", weeks: 2 } }, salon)).toEqual(["Win-back is for clients away 4 to 104 weeks."]);
  });
});

describe("results", () => {
  it("credits a booking within two weeks to the message before it, once", () => {
    const r = automationResults(
      [
        { id: "m1", kind: "rebook", clientId: "a", sentAt: "2026-10-01T15:00:00Z", optedOut: false },
        { id: "m2", kind: "birthday", clientId: "a", sentAt: "2026-10-03T15:00:00Z", optedOut: false },
        { id: "m3", kind: "rebook", clientId: "b", sentAt: "2026-10-01T15:00:00Z", optedOut: true },
        { id: "m4", kind: "rebook", clientId: "c", sentAt: "2026-10-01T15:00:00Z", optedOut: false },
      ],
      [
        { appointmentId: "x", clientId: "a", createdAt: "2026-10-05T15:00:00Z", revenueCents: 9000 },
        // Booked before the message, and three weeks after: neither counts.
        { appointmentId: "y", clientId: "c", createdAt: "2026-09-30T15:00:00Z", revenueCents: 5000 },
        { appointmentId: "z", clientId: "c", createdAt: "2026-10-22T15:00:00Z", revenueCents: 5000 },
      ],
    );
    expect(r.rebook).toEqual({ sent: 3, booked: 1, revenueCents: 9000, optedOut: 1 });
    expect(r.birthday).toEqual({ sent: 1, booked: 0, revenueCents: 0, optedOut: 0 });
  });
});

describe("Denise's suggestions", () => {
  const facts = { overdue: 40, lapsed: 120, birthdays: 290, checkoutsLast30: 300, reachable: 430, hasReviewLink: true };

  it("come from the salon's numbers, for automations that are off", () => {
    const s = suggestAutomations(facts, new Set(["win_back"]));
    expect(s.map((x) => x.kind)).toEqual(["rebook", "review", "birthday"]);
    expect(s[0].reason).toBe("40 regulars are past their usual return with nothing booked. A reminder brings many of them back without anyone at the desk having to call.");
    expect(suggestAutomations({ ...facts, reachable: 0 }, new Set())).toEqual([]);
    expect(suggestAutomations({ ...facts, hasReviewLink: false, overdue: 2, lapsed: 0, birthdays: 0 }, new Set())).toEqual([]);
  });
});
