import { describe, expect, it } from "vitest";
import { allowedChannels, channelFor, consentEventText, keywordOf, noTextsFlag, type ClientConsent } from "@/lib/messaging/consent";
import { inboundDigits, twilioSignature, validSignature } from "@/lib/messaging/inbound";
import { renderStaffMessage, smsCounterText, smsParts, templateProblem, withStopLine } from "@/lib/messaging/templates";

const client = (over: Partial<ClientConsent> = {}): ClientConsent => ({
  phone: "(312) 555-0142",
  email: "ava@example.com",
  appointmentSmsOk: true,
  appointmentEmailOk: true,
  smsOptIn: false,
  emailOptIn: false,
  smsStoppedAt: null,
  ...over,
});

describe("which channel a message can use", () => {
  it("keeps appointment messages and marketing apart", () => {
    // Said no to marketing: appointment messages still go.
    expect(allowedChannels(client(), "appointment")).toEqual(["sms", "email"]);
    expect(allowedChannels(client(), "marketing")).toEqual([]);
    expect(allowedChannels(client({ smsOptIn: true }), "marketing")).toEqual(["sms"]);
  });

  it("falls back to email after a STOP, for every text", () => {
    const stopped = client({ smsStoppedAt: "2026-10-20T15:00:00Z", smsOptIn: true });
    expect(channelFor(stopped, "appointment", "sms")).toEqual({ channel: "email", to: "ava@example.com" });
    expect(allowedChannels(stopped, "marketing")).toEqual([]);
    expect(noTextsFlag(stopped)).toBe("No texts — call or email");
    expect(noTextsFlag(client({ smsStoppedAt: "2026-10-20T15:00:00Z", email: null }))).toBe("No texts — call");
    expect(channelFor(client({ smsStoppedAt: "2026-10-20T15:00:00Z", email: null }), "appointment")).toBeNull();
    expect(noTextsFlag(client())).toBeNull();
  });

  it("honours the preferred channel when it's allowed", () => {
    expect(channelFor(client(), "appointment", "email")).toEqual({ channel: "email", to: "ava@example.com" });
    expect(channelFor(client({ appointmentEmailOk: false }), "appointment", "email")).toEqual({ channel: "sms", to: "(312) 555-0142" });
  });

  it("reads STOP, START and HELP however they're typed", () => {
    expect(keywordOf(" stop ")).toBe("stop");
    expect(keywordOf("Unsubscribe.")).toBe("stop");
    expect(keywordOf("START")).toBe("start");
    expect(keywordOf("help!")).toBe("help");
    expect(keywordOf("Stop by at 3?")).toBeNull();
  });

  it("says what each consent event was", () => {
    expect(consentEventText({ purpose: "appointment", channel: "sms", granted: false, source: "sms_keyword", detail: "STOP" })).toBe("Appointment texts off: replied STOP");
    expect(consentEventText({ purpose: "marketing", channel: "email", granted: false, source: "unsubscribe_link", detail: "rebook" })).toBe("Marketing emails off with the unsubscribe link");
  });
});

describe("staff messages", () => {
  const facts = { salon: "Maple & Ash", phone: "(555) 010-0100", firstName: "Ava", when: "today at 2:00pm", stylist: "Gil", manageLink: "https://x.test/m/abc" };

  it("are fixed templates our code fills in, with STOP on texts", () => {
    expect(renderStaffMessage("running_late", { ...facts, minutes: 15 }, "sms").body).toBe(
      "Hi Ava, Maple & Ash here. We're running about 15 minutes behind for your visit today at 2:00pm. Sorry for the wait. Reply STOP to stop texts.",
    );
    expect(renderStaffMessage("reminder", facts, "email")).toEqual({
      subject: "Your visit at Maple & Ash",
      body: "Hi Ava, a reminder of your visit at Maple & Ash today at 2:00pm with Gil. Change or cancel: https://x.test/m/abc",
    });
    expect(templateProblem("running_late", { minutes: 2 })).toBe("Say how many minutes behind (5 to 120).");
    expect(templateProblem("ready_early", { time: "1:30pm" })).toBeNull();
  });
});

describe("what staff write themselves", () => {
  it("always ends a text with how to stop, once", () => {
    expect(withStopLine("See you soon!  ")).toBe("See you soon! Reply STOP to stop texts.");
    expect(withStopLine("Reply STOP to opt out.")).toBe("Reply STOP to opt out.");
  });

  it("counts a text: one up to 160, then parts of 153", () => {
    expect(smsParts("a".repeat(160))).toEqual({ characters: 160, parts: 1, plain: true });
    expect(smsParts("a".repeat(161))).toEqual({ characters: 161, parts: 2, plain: true });
    expect(smsParts("a".repeat(307)).parts).toBe(3);
    // Characters outside the text alphabet: 70, then parts of 67.
    expect(smsParts("See you soon \u{1F600}".repeat(1))).toMatchObject({ plain: false, parts: 1 });
    expect(smsParts("’".repeat(71))).toMatchObject({ plain: false, parts: 2 });
    // Brackets and the euro take two places.
    expect(smsParts("€".repeat(80)).characters).toBe(160);
    expect(smsParts("").parts).toBe(0);
  });

  it("warns once a text goes over 160 characters", () => {
    expect(smsCounterText("a".repeat(142))).toEqual({ text: "142 / 160", warn: false });
    expect(smsCounterText("a".repeat(170))).toEqual({ text: "170 characters: sends as 2 texts", warn: true });
    expect(smsCounterText("’".repeat(80)).text).toBe("80 characters: sends as 2 texts (emoji or special characters make texts shorter)");
  });
});

describe("texts coming in", () => {
  it("checks the provider's signature", () => {
    const params = { From: "+13125550142", Body: "STOP", To: "+15550100" };
    const sig = twilioSignature("secret", "https://app.test/api/messages/inbound", params);
    expect(validSignature("secret", "https://app.test/api/messages/inbound", params, sig)).toBe(true);
    expect(validSignature("secret", "https://app.test/api/messages/inbound", { ...params, Body: "START" }, sig)).toBe(false);
    expect(validSignature("other", "https://app.test/api/messages/inbound", params, sig)).toBe(false);
    expect(validSignature("secret", "https://app.test/api/messages/inbound", params, null)).toBe(false);
  });

  it("reads US numbers", () => {
    expect(inboundDigits("+1 (312) 555-0142")).toBe("3125550142");
    expect(inboundDigits("+44 20 7946 0958")).toBeNull();
  });
});
