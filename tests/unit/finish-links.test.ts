import { describe, expect, it } from "vitest";
import { isCardToken } from "@/lib/policy-link";
import { isFormToken } from "@/lib/form-links";
import { finishMessage, isFinishToken, partToken } from "@/lib/finish-links";

const token = "A".repeat(43);

describe("Finish your booking links", () => {
  it("works out a card link's and a form link's own tokens, each different and the same every time", () => {
    const card = partToken(token, "card");
    const forms = partToken(token, "forms");
    expect(isFinishToken(token)).toBe(true);
    expect(isCardToken(card)).toBe(true);
    expect(isFormToken(forms)).toBe(true);
    expect(card).not.toBe(forms);
    expect(card).not.toBe(token);
    expect(partToken(token, "card")).toBe(card);
    expect(partToken("B".repeat(43), "card")).not.toBe(card);
  });

  it("says what to do in one fixed message", () => {
    const both = finishMessage("Maple & Ash", "Ava", "Tue, Nov 10 at 2:15pm", { card: true, depositCents: 4000, forms: ["Color consent"] }, "https://x/finish/t", "sms");
    expect(both).toEqual({
      subject: null,
      body: "Maple & Ash: Hi Ava, to finish your booking for Tue, Nov 10 at 2:15pm, please pay your $40.00 deposit and sign your Color consent here: https://x/finish/t",
    });
    expect(finishMessage("S", "Ava", "w", { card: true, depositCents: 0, forms: [] }, "u", "sms").body).toBe("S: Hi Ava, to finish your booking for w, please add a card to hold it here: u");
    expect(finishMessage("S", "Ava", "w", { card: false, depositCents: 0, forms: ["A", "B"] }, "u", "email")).toEqual({
      subject: "Finish your booking at S",
      body: "S: Hi Ava, to finish your booking for w, please sign 2 short forms here: u",
    });
  });
});
