// Consultation and consent forms: templates (built by owners), filling one
// in, and which forms a client still needs. Pure, shared by the screens,
// server actions and tests.

export type FieldType = "text" | "checkbox" | "yes_no" | "signature";
export const FIELD_LABELS: Record<FieldType, string> = { text: "Text answer", checkbox: "Checkbox", yes_no: "Yes / no", signature: "Signature" };

export type FormField = { id: string; type: FieldType; label: string; required: boolean };
export type FormRequirement = "none" | "first_visit" | "services";
export type FormTemplate = { id: string; name: string; intro: string | null; fields: FormField[]; required: FormRequirement; serviceIds: string[]; isActive: boolean };

export type Answers = Record<string, string | boolean>;

// Template fields from the builder: labeled, at most one signature, ids
// unique.
export function parseFields(raw: unknown): { ok: true; fields: FormField[] } | { ok: false; error: string } {
  if (!Array.isArray(raw) || raw.length === 0) return { ok: false, error: "Add at least one question." };
  if (raw.length > 40) return { ok: false, error: "Up to 40 questions." };
  const fields: FormField[] = [];
  const ids = new Set<string>();
  for (const f of raw) {
    const type = f?.type as FieldType;
    if (!(type in FIELD_LABELS)) return { ok: false, error: "Choose a type for each question." };
    const label = String(f?.label ?? "").trim();
    if (!label || label.length > 300) return { ok: false, error: "Each question needs its text (up to 300 characters)." };
    let id = String(f?.id ?? "").trim() || `q${fields.length + 1}`;
    while (ids.has(id)) id = `${id}_`;
    ids.add(id);
    fields.push({ id, type, label, required: type === "signature" ? true : Boolean(f?.required) });
  }
  if (fields.filter((f) => f.type === "signature").length > 1) return { ok: false, error: "A form has one signature." };
  return { ok: true, fields };
}

// A filled-in form: every required question answered, and signed if it
// asks for a signature. Answers are trimmed to the template's questions.
export function checkAnswers(fields: readonly FormField[], raw: Answers, signature: string | null): { ok: true; answers: Answers } | { ok: false; missing: string[] } {
  const answers: Answers = {};
  const missing: string[] = [];
  for (const f of fields) {
    const v = raw[f.id];
    if (f.type === "signature") {
      const signed = Boolean(signature && signature.startsWith("data:image/png;base64,"));
      answers[f.id] = signed;
      if (f.required && !signed) missing.push(f.label);
    } else if (f.type === "checkbox") {
      answers[f.id] = v === true;
      if (f.required && v !== true) missing.push(f.label);
    } else if (f.type === "yes_no") {
      const yn = v === "yes" || v === "no" ? v : "";
      answers[f.id] = yn;
      if (f.required && !yn) missing.push(f.label);
    } else {
      const text = typeof v === "string" ? v.trim().slice(0, 2000) : "";
      answers[f.id] = text;
      if (f.required && !text) missing.push(f.label);
    }
  }
  return missing.length ? { ok: false, missing } : { ok: true, answers };
}

// Required forms a client hasn't signed: ones for a first visit (if it is
// one) and ones for services on this visit.
export function missingForms(
  templates: readonly FormTemplate[],
  signedTemplateIds: ReadonlySet<string>,
  visit: { firstVisit: boolean; serviceIds: readonly string[] },
): FormTemplate[] {
  return templates.filter(
    (t) =>
      t.isActive &&
      !signedTemplateIds.has(t.id) &&
      ((t.required === "first_visit" && visit.firstVisit) || (t.required === "services" && t.serviceIds.some((id) => visit.serviceIds.includes(id)))),
  );
}
