// Campaigns: who gets one, and whether it can go.
import { describe, expect, it } from "vitest";
import { resultsBy } from "@/lib/automations";
import { audienceText, campaignProblem, splitAudience, type AudienceClient } from "@/lib/campaigns";

const OK = { name: "Fall", subject: "Hi", body: "Hi {first_name}: {booking_link}" };
const consent = (over = {}) => ({ phone: "3125550100", email: "a@b.co", appointmentSmsOk: true, appointmentEmailOk: true, smsOptIn: true, emailOptIn: true, smsStoppedAt: null, ...over });
const client = (id: string, over = {}): AudienceClient => ({ id, firstName: id, consent: consent(over) });

describe("the message", () => {
  it("needs a name, a subject and known fields", () => {
    expect(campaignProblem(OK, true)).toBeNull();
    expect(campaignProblem({ ...OK, name: " " }, true)).toMatch(/name/);
    expect(campaignProblem({ ...OK, subject: "" }, true)).toMatch(/subject/);
    expect(campaignProblem({ ...OK, body: "{offer}" }, true)).toMatch(/braces/);
  });
  it("can't link to a booking site that's off", () => {
    expect(campaignProblem(OK, false)).toMatch(/Online booking/);
    expect(campaignProblem({ ...OK, body: "Hello" }, false)).toBeNull();
  });
});

describe("the audience", () => {
  const list = [client("a"), client("b", { smsOptIn: false, emailOptIn: false }), client("c"), client("d", { smsStoppedAt: "2026-01-01" }), client("e", { smsOptIn: false, email: null })];
  it("keeps to who said yes, not messaged this week, on a channel they allow", () => {
    const a = splitAudience(list, new Set(["c"]), "sms");
    expect(a.recipients.map((r) => [r.id, r.channel])).toEqual([["a", "sms"], ["d", "email"]]);
    expect(a).toMatchObject({ noConsent: 2, recentlyMessaged: 1 });
  });
  it("says so", () => {
    expect(audienceText(splitAudience(list, new Set(["c"]), "sms"))).toBe("2 clients will get this. Left out: 2 haven't said yes to offers, 1 had a message from us this week.");
  });
});

describe("results", () => {
  it("credit a booking to the message before it and ignore other keys", () => {
    const m = (id: string, kind: string) => ({ id, kind, clientId: "c", sentAt: "2026-01-01T12:00:00Z", optedOut: false });
    const out = resultsBy(["x"], [m("1", "x"), m("2", "other")], [{ appointmentId: "v", clientId: "c", createdAt: "2026-01-03T12:00:00Z", revenueCents: 500 }]);
    expect(out).toEqual({ x: { sent: 1, booked: 1, revenueCents: 500, optedOut: 0 } });
  });
});
