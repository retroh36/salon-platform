// Importing clients from a CSV file (pure, unit-tested): reading the file,
// guessing which column is which, and turning rows into clients, counting
// what's wrong by row number. The database decides who's already here
// (import_clients). Nothing here logs a value from the file.

import { normalizePhone } from "@/lib/clients";

export const MAX_IMPORT_ROWS = 50_000;
export const IMPORT_BATCH = 1000;

// RFC 4180: quoted cells, doubled quotes, line breaks inside quotes, a BOM.
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const body = text.replace(/^﻿/, "");
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (quoted) {
      if (c === '"' && body[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && cell === "") quoted = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && body[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      if (row.some((v) => v.trim())) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((v) => v.trim())) rows.push(row);
  return rows;
}

export const IMPORT_FIELDS = ["first_name", "last_name", "full_name", "phone", "email", "birthday", "notes", "allergies"] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];
// Each field's column number, or null for none.
export type ColumnMap = Record<ImportField, number | null>;

export const FIELD_LABELS: Record<ImportField, string> = {
  first_name: "First name",
  last_name: "Last name",
  full_name: "Full name",
  phone: "Phone",
  email: "Email",
  birthday: "Birthday",
  notes: "Notes",
  allergies: "Allergies",
};

const HEADERS: Record<ImportField, string[]> = {
  first_name: ["first name", "firstname", "given name", "forename"],
  last_name: ["last name", "lastname", "surname", "family name"],
  full_name: ["name", "full name", "client name", "client", "customer name"],
  phone: ["mobile", "mobile phone", "mobile number", "cell", "cell phone", "phone", "phone number", "telephone"],
  email: ["email", "email address", "e mail"],
  birthday: ["birthday", "date of birth", "dob", "birth date", "birthdate"],
  notes: ["notes", "client notes", "comments"],
  allergies: ["allergies", "allergy"],
};

const plain = (header: string) => header.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export function guessColumns(headers: readonly string[]): ColumnMap {
  const names = headers.map(plain);
  // In the order listed, so a mobile column wins over a landline.
  const find = (field: ImportField) => {
    for (const h of HEADERS[field]) {
      const at = names.indexOf(h);
      if (at >= 0) return at;
    }
    return null;
  };
  return Object.fromEntries(IMPORT_FIELDS.map((f) => [f, find(f)])) as ColumnMap;
}

export type ImportRow = {
  first_name: string;
  last_name: string;
  phone: string | null;
  email: string | null;
  birth_month: number | null;
  birth_day: number | null;
  notes: string | null;
  allergies: string | null;
};

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

// 1990-03-14, 3/14/1990, 03/14, 3-14.
export function parseBirthday(value: string): { month: number; day: number } | null {
  const v = value.trim();
  const iso = /^\d{4}-(\d{1,2})-(\d{1,2})/.exec(v);
  const us = /^(\d{1,2})[/-](\d{1,2})(?:[/-]\d{2,4})?$/.exec(v);
  const m = iso ?? us;
  if (!m) return null;
  const [month, day] = [Number(m[1]), Number(m[2])];
  return month >= 1 && month <= 12 && day >= 1 && day <= DAYS_IN_MONTH[month - 1] ? { month, day } : null;
}

export type ImportProblem = "no_name" | "bad_phone" | "bad_email" | "bad_birthday";

export const PROBLEM_TEXT: Record<ImportProblem, string> = {
  no_name: "no name, so they won't be added",
  bad_phone: "a phone number we can't read, added without it",
  bad_email: "an email we can't read, added without it",
  bad_birthday: "a birthday we can't read, added without it",
};

export type ImportPlan = { rows: ImportRow[]; problems: Record<ImportProblem, number[]> };

// The data rows (no header) as clients. Row numbers are the file's own,
// counting the header as row 1.
export function planImport(data: readonly (readonly string[])[], columns: ColumnMap): ImportPlan {
  const rows: ImportRow[] = [];
  const problems: ImportPlan["problems"] = { no_name: [], bad_phone: [], bad_email: [], bad_birthday: [] };
  data.forEach((cells, index) => {
    const at = index + 2;
    const get = (f: ImportField) => (columns[f] === null ? "" : (cells[columns[f]!] ?? "").trim());
    let first = get("first_name");
    let last = get("last_name");
    if (!first && get("full_name")) {
      const parts = get("full_name").split(/\s+/);
      last = last || (parts.length > 1 ? parts.pop()! : "");
      first = parts.join(" ");
    }
    if (!first) {
      problems.no_name.push(at);
      return;
    }
    const rawPhone = get("phone");
    const phone = rawPhone ? normalizePhone(rawPhone) : null;
    if (rawPhone && !phone) problems.bad_phone.push(at);
    const rawEmail = get("email");
    const email = EMAIL.test(rawEmail) ? rawEmail.toLowerCase() : null;
    if (rawEmail && !email) problems.bad_email.push(at);
    const rawBirthday = get("birthday");
    const birthday = rawBirthday ? parseBirthday(rawBirthday) : null;
    if (rawBirthday && !birthday) problems.bad_birthday.push(at);
    rows.push({ first_name: first.slice(0, 100), last_name: last.slice(0, 100), phone, email, birth_month: birthday?.month ?? null, birth_day: birthday?.day ?? null, notes: get("notes").slice(0, 5000) || null, allergies: get("allergies").slice(0, 1000) || null });
  });
  return { rows, problems };
}
