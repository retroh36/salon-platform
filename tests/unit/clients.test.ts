import { describe, expect, it } from "vitest";
import {
  canEditClients,
  escapeLike,
  formatDate,
  normalizePhone,
  parseClientForm,
  parseClientSearch,
  parseFormulaForm,
  todayIn,
} from "@/lib/clients";

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.append(k, v);
  return data;
}

const TODAY = "2026-10-21";

describe("parseClientSearch", () => {
  it("is empty for blank input", () => {
    expect(parseClientSearch("  ")).toEqual({ kind: "all" });
  });

  it.each([
    ["(312) 555-0142", "3125550142"],
    ["555-0142", "5550142"],
    ["0142", "0142"],
    ["+1 312 555 0142", "3125550142"],
  ])("treats %j as a phone search", (input, digits) => {
    expect(parseClientSearch(input)).toEqual({ kind: "phone", digits });
  });

  it("treats short numbers and words as a name search", () => {
    expect(parseClientSearch("12")).toEqual({ kind: "name", terms: ["12"] });
    expect(parseClientSearch("  Mia   PATEL ")).toEqual({ kind: "name", terms: ["mia", "patel"] });
    expect(parseClientSearch("o'brien")).toEqual({ kind: "name", terms: ["o'brien"] });
  });

  it("caps the number of words", () => {
    expect(parseClientSearch("a b c d e f g")).toEqual({ kind: "name", terms: ["a", "b", "c", "d", "e"] });
  });
});

describe("escapeLike", () => {
  it("escapes wildcards and drops *", () => {
    expect(escapeLike("50%_off\\")).toBe("50\\%\\_off\\\\");
    expect(escapeLike("a*b")).toBe("ab");
  });
});

describe("normalizePhone", () => {
  it.each([
    ["3125550142", "(312) 555-0142"],
    ["(312) 555-0142", "(312) 555-0142"],
    ["1-312-555-0142", "(312) 555-0142"],
    ["312.555.0142", "(312) 555-0142"],
  ])("formats %j", (input, out) => {
    expect(normalizePhone(input)).toBe(out);
  });

  it.each(["555-0142", "23125550142", "phone"])("rejects %j", (input) => {
    expect(normalizePhone(input)).toBeNull();
  });
});

describe("dates", () => {
  it("gives today's date in the location's timezone", () => {
    // 03:30 UTC on Oct 22 is still Oct 21 in Chicago.
    const now = new Date("2026-10-22T03:30:00Z");
    expect(todayIn("America/Chicago", now)).toBe("2026-10-21");
    expect(todayIn("Asia/Tokyo", now)).toBe("2026-10-22");
  });

  it("formats a date without shifting it", () => {
    expect(formatDate("2026-03-04")).toBe("Mar 4, 2026");
  });
});

describe("canEditClients", () => {
  it("lets front of house edit, not stylists", () => {
    expect(canEditClients("owner")).toBe(true);
    expect(canEditClients("manager")).toBe(true);
    expect(canEditClients("front_desk")).toBe(true);
    expect(canEditClients("stylist")).toBe(false);
  });
});

describe("parseClientForm", () => {
  it("parses and normalizes a full form", () => {
    const result = parseClientForm(
      form({
        first_name: " Mia ",
        last_name: "Patel",
        email: " Mia.Patel@Example.com ",
        phone: "312.555.0142",
        preferred_staff_id: "d0000000-0000-4000-8000-000000000004",
        preferences: "Quiet appointment",
        notes: "",
        allergies: "PPD sensitivity",
        sms_opt_in: "on",
        consent_signed: "on",
        consent_signed_on: "2026-01-15",
      }),
      TODAY,
    );
    expect(result).toEqual({
      ok: true,
      value: {
        first_name: "Mia",
        last_name: "Patel",
        email: "mia.patel@example.com",
        phone: "(312) 555-0142",
        preferred_staff_id: "d0000000-0000-4000-8000-000000000004",
        preferences: "Quiet appointment",
        notes: null,
        allergies: "PPD sensitivity",
        sms_opt_in: true,
        email_opt_in: false,
        consent_signed_on: "2026-01-15",
      },
    });
  });

  it("only needs a first name", () => {
    const result = parseClientForm(form({ first_name: "Walk-in" }), TODAY);
    expect(result.ok && result.value).toMatchObject({ first_name: "Walk-in", email: null, phone: null, consent_signed_on: null });
  });

  it("ignores the consent date when the box isn't ticked", () => {
    const result = parseClientForm(form({ first_name: "A", consent_signed_on: "2026-01-15" }), TODAY);
    expect(result.ok && result.value.consent_signed_on).toBeNull();
  });

  it("defaults the consent date to today", () => {
    const result = parseClientForm(form({ first_name: "A", consent_signed: "on" }), TODAY);
    expect(result.ok && result.value.consent_signed_on).toBe(TODAY);
  });

  it("reports every problem at once", () => {
    const result = parseClientForm(
      form({ first_name: " ", email: "not-an-email", phone: "555", consent_signed: "on", consent_signed_on: "2026-12-01" }),
      TODAY,
    );
    expect(!result.ok && result.errors).toEqual({
      first_name: "Enter a first name.",
      email: "Enter a valid email address.",
      phone: "Enter a 10-digit phone number.",
      consent_signed_on: "The date can't be in the future.",
    });
  });

  it("rejects impossible dates", () => {
    const result = parseClientForm(form({ first_name: "A", consent_signed: "on", consent_signed_on: "2026-02-30" }), TODAY);
    expect(!result.ok && result.errors.consent_signed_on).toBe("Enter a valid date.");
  });
});

describe("parseFormulaForm", () => {
  it("parses an entry and defaults the date to today", () => {
    expect(parseFormulaForm(form({ formula: " 6N + 6NB, 20 vol ", notes: "" }), TODAY)).toEqual({
      ok: true,
      value: { visit_date: TODAY, formula: "6N + 6NB, 20 vol", notes: null },
    });
  });

  it("requires a formula and a date that isn't in the future", () => {
    expect(parseFormulaForm(form({ formula: "", visit_date: "2026-10-22" }), TODAY)).toEqual({
      ok: false,
      errors: { formula: "Enter the formula.", visit_date: "The visit date can't be in the future." },
    });
  });
});
