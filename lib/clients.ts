import type { StaffRole } from "@/lib/staff";

// Owners, managers and front desk manage client records. Everyone can view
// clients and add formula entries. RLS enforces the same rules.
const CLIENT_EDITOR_ROLES: StaffRole[] = ["owner", "manager", "front_desk"];

export function canEditClients(role: StaffRole): boolean {
  return CLIENT_EDITOR_ROLES.includes(role);
}

export const SEARCH_LIMIT = 50;

export type ClientSearch =
  | { kind: "all" }
  | { kind: "phone"; digits: string }
  | { kind: "name"; terms: string[] };

// "(312) 555-0142", "5550142" -> phone search on digits; anything else ->
// every word must appear in the client's name.
export function parseClientSearch(query: string): ClientSearch {
  const q = query.trim();
  if (!q) return { kind: "all" };

  const digits = q.replace(/\D/g, "");
  if (/^[\d\s()+.-]+$/.test(q) && digits.length >= 3) {
    // A US country code isn't stored, so drop it from an 11-digit number.
    return { kind: "phone", digits: digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits };
  }

  const terms = q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 5);
  return { kind: "name", terms };
}

// The Clients list's columns that sort, each starting in the way that's
// most useful (most recent visit first, biggest spender first), and where
// clients without one go: always last.
export const CLIENT_SORTS = {
  name: { column: "search_name", ascending: true },
  last_visit: { column: "last_visit_at", ascending: false },
  next_visit: { column: "next_visit_at", ascending: true },
  stylist: { column: "usual_staff_name", ascending: true },
  spend: { column: "spend_cents", ascending: false },
} as const;

export type ClientSort = keyof typeof CLIENT_SORTS;
export type ClientOrder = { sort: ClientSort; ascending: boolean };

// ?sort=spend&dir=asc -> spend, lowest first. Anything unknown is by name;
// spend only for those who can see it.
export function parseClientOrder(sort: unknown, dir: unknown, canSeeSpend: boolean): ClientOrder {
  const key = typeof sort === "string" && sort in CLIENT_SORTS && (sort !== "spend" || canSeeSpend) ? (sort as ClientSort) : "name";
  const ascending = dir === "asc" ? true : dir === "desc" ? false : CLIENT_SORTS[key].ascending;
  return { sort: key, ascending };
}

// The link a column's header goes to: the other way round if it's the
// sort already, else that column in its own first direction.
export function clientSortHref(current: ClientOrder, sort: ClientSort, query: string): string {
  const ascending = current.sort === sort ? !current.ascending : CLIENT_SORTS[sort].ascending;
  const params: string[] = query ? [`q=${encodeURIComponent(query)}`] : [];
  if (sort !== "name" || !ascending) params.push(`sort=${sort}`, `dir=${ascending ? "asc" : "desc"}`);
  const qs = params.join("&");
  return qs ? `/clients?${qs}` : "/clients";
}

// Makes user input match literally in a LIKE pattern: escapes % _ and \, and
// drops *, which the database API treats as a wildcard.
export function escapeLike(value: string): string {
  return value.replace(/\*/g, "").replace(/[\\%_]/g, (c) => `\\${c}`);
}

// Formats a US number as "(312) 555-0142". Returns null if it isn't 10
// digits (11 with a leading 1).
export function normalizePhone(input: string): string | null {
  let digits = input.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  if (digits.length !== 10) return null;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

// "2026-03-04" -> "Mar 4, 2026", without shifting the date by timezone.
export function formatDate(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// ---------------------------------------------------------------------------
// Form parsing
// ---------------------------------------------------------------------------

type FormLike = { get(name: string): FormDataEntryValue | null };
const text = (form: FormLike, name: string) => String(form.get(name) ?? "").trim();
const optional = (value: string) => (value === "" ? null : value);

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export type ClientInput = {
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  preferred_staff_id: string | null;
  // Books only with their preferred stylist (a sick-day rescue offers them
  // their stylist's next openings, never someone else).
  only_sees_preferred: boolean;
  preferences: string | null;
  notes: string | null;
  allergies: string | null;
  sms_opt_in: boolean;
  email_opt_in: boolean;
  consent_signed_on: string | null;
  birth_month: number | null;
  birth_day: number | null;
};

export type ClientFormErrors = Partial<Record<"first_name" | "email" | "phone" | "consent_signed_on" | "birthday", string>>;

export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function isRealDate(value: string): boolean {
  if (!DATE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

// Form fields: first_name, last_name, email, phone, preferred_staff_id,
// only_sees_preferred (checkbox), preferences, notes, allergies, sms_opt_in, email_opt_in, consent_signed
// (checkbox), consent_signed_on (date), birth_month and birth_day (both or
// neither). `today` is the location's date.
export function parseClientForm(
  form: FormLike,
  today: string,
): { ok: true; value: ClientInput } | { ok: false; errors: ClientFormErrors } {
  const errors: ClientFormErrors = {};

  const first_name = text(form, "first_name");
  if (!first_name) errors.first_name = "Enter a first name.";

  const email = text(form, "email").toLowerCase();
  if (email && !EMAIL.test(email)) errors.email = "Enter a valid email address.";

  const rawPhone = text(form, "phone");
  const phone = rawPhone ? normalizePhone(rawPhone) : null;
  if (rawPhone && !phone) errors.phone = "Enter a 10-digit phone number.";

  let consent_signed_on: string | null = null;
  if (form.get("consent_signed")) {
    consent_signed_on = text(form, "consent_signed_on") || today;
    if (!isRealDate(consent_signed_on)) errors.consent_signed_on = "Enter a valid date.";
    else if (consent_signed_on > today) errors.consent_signed_on = "The date can't be in the future.";
  }

  // A birthday: month and day (the year isn't asked for).
  const month = text(form, "birth_month");
  const day = text(form, "birth_day");
  let birth_month: number | null = null;
  let birth_day: number | null = null;
  if (month || day) {
    birth_month = Number(month);
    birth_day = Number(day);
    if (!Number.isInteger(birth_month) || birth_month < 1 || birth_month > 12 || !Number.isInteger(birth_day) || birth_day < 1 || birth_day > DAYS_IN_MONTH[birth_month - 1]) {
      errors.birthday = "Choose a month and a day that exists.";
    }
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: {
      first_name,
      last_name: text(form, "last_name"),
      email: optional(email),
      phone,
      preferred_staff_id: optional(text(form, "preferred_staff_id")),
      only_sees_preferred: form.get("only_sees_preferred") !== null && Boolean(text(form, "preferred_staff_id")),
      preferences: optional(text(form, "preferences")),
      notes: optional(text(form, "notes")),
      allergies: optional(text(form, "allergies")),
      sms_opt_in: form.get("sms_opt_in") !== null,
      email_opt_in: form.get("email_opt_in") !== null,
      consent_signed_on,
      birth_month,
      birth_day,
    },
  };
}

export type FormulaInput = { visit_date: string; formula: string; notes: string | null };
export type FormulaFormErrors = Partial<Record<"visit_date" | "formula", string>>;

export function parseFormulaForm(
  form: FormLike,
  today: string,
): { ok: true; value: FormulaInput } | { ok: false; errors: FormulaFormErrors } {
  const errors: FormulaFormErrors = {};

  const visit_date = text(form, "visit_date") || today;
  if (!isRealDate(visit_date)) errors.visit_date = "Enter a valid date.";
  else if (visit_date > today) errors.visit_date = "The visit date can't be in the future.";

  const formula = text(form, "formula");
  if (!formula) errors.formula = "Enter the formula.";
  else if (formula.length > 2000) errors.formula = "Keep it under 2,000 characters.";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { visit_date, formula, notes: optional(text(form, "notes")) } };
}
