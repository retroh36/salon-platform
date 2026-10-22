import { describe, expect, it } from "vitest";
import { checkAnswers, missingForms, parseFields, type FormField, type FormTemplate } from "@/lib/forms";

const SIG = "data:image/png;base64,AAAA";
const FIELDS: FormField[] = [
  { id: "history", type: "text", label: "Hair history", required: false },
  { id: "allergy", type: "yes_no", label: "Allergies?", required: true },
  { id: "photos", type: "checkbox", label: "Photos OK", required: false },
  { id: "agree", type: "checkbox", label: "I agree", required: true },
  { id: "sign", type: "signature", label: "Signature", required: true },
];

describe("building a form", () => {
  it("needs labeled questions of a known type, and at most one signature", () => {
    expect(parseFields([])).toEqual({ ok: false, error: "Add at least one question." });
    expect(parseFields([{ type: "text", label: " " }])).toMatchObject({ ok: false });
    expect(parseFields([{ type: "essay", label: "x" }])).toMatchObject({ ok: false });
    expect(parseFields([{ type: "signature", label: "A" }, { type: "signature", label: "B" }])).toEqual({ ok: false, error: "A form has one signature." });
    expect(parseFields([{ type: "yes_no", label: " Pregnant? ", required: true }, { type: "signature", label: "Sign", required: false }, { id: "q1", type: "text", label: "x" }])).toEqual({
      ok: true,
      fields: [
        { id: "q1", type: "yes_no", label: "Pregnant?", required: true },
        { id: "q2", type: "signature", label: "Sign", required: true },
        { id: "q1_", type: "text", label: "x", required: false },
      ],
    });
  });
});

describe("filling in a form", () => {
  it("needs every required answer and the signature", () => {
    expect(checkAnswers(FIELDS, { allergy: "maybe" }, null)).toEqual({ ok: false, missing: ["Allergies?", "I agree", "Signature"] });
    expect(checkAnswers(FIELDS, { allergy: "no", agree: true, extra: "x", history: "  Box dye  " }, SIG)).toEqual({
      ok: true,
      answers: { history: "Box dye", allergy: "no", photos: false, agree: true, sign: true },
    });
  });
});

describe("forms a client still needs", () => {
  const t = (id: string, required: FormTemplate["required"], serviceIds: string[] = [], isActive = true): FormTemplate => ({ id, name: id, intro: null, fields: FIELDS, required, serviceIds, isActive });
  const templates = [t("consult", "first_visit"), t("color", "services", ["balayage"]), t("optional", "none"), t("old", "first_visit", [], false)];
  it("is first-visit forms on a first visit and service forms for those services, unless signed", () => {
    expect(missingForms(templates, new Set(), { firstVisit: true, serviceIds: ["cut"] }).map((f) => f.id)).toEqual(["consult"]);
    expect(missingForms(templates, new Set(), { firstVisit: false, serviceIds: ["cut", "balayage"] }).map((f) => f.id)).toEqual(["color"]);
    expect(missingForms(templates, new Set(["consult", "color"]), { firstVisit: true, serviceIds: ["balayage"] })).toEqual([]);
  });
});
