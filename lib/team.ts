// Managing the team (Team → Add team member, a member's page): who may
// manage whom, the member form, and where each person's login stands.
// Owners manage everyone; managers (with the team permission) manage
// everyone but owners and can't make anyone an owner (the database enforces
// the same). Pure.

import { isUuid } from "@/lib/ids";
import { normalizePhone } from "@/lib/clients";
import { parseWeeklyHoursForm, STAFF_LEVELS, type StaffLevel, type WeeklyHoursRow } from "@/lib/schedule-forms";
import { can } from "@/lib/permissions";
import type { StaffRole } from "@/lib/staff";
import type { Weekday } from "@/lib/scheduling/time";

type FormLike = { get(name: string): FormDataEntryValue | null; getAll(name: string): FormDataEntryValue[] };

export const ALL_ROLES: StaffRole[] = ["owner", "manager", "front_desk", "stylist", "assistant"];

type Me = { role: StaffRole; permissions: readonly string[] };

// Whether `me` may change this person (null: someone new).
export function canManageMember(me: Me, target: { role: StaffRole } | null): boolean {
  if (me.role === "owner") return true;
  return me.role === "manager" && can(me, "team") && (!target || target.role !== "owner");
}

// The roles `me` can give someone.
export function rolesFor(me: Me): StaffRole[] {
  return me.role === "owner" ? ALL_ROLES : canManageMember(me, null) ? ALL_ROLES.filter((r) => r !== "owner") : [];
}

// Only owners send a password reset for someone who already signs in.
export const canResetPassword = (me: { role: StaffRole }) => me.role === "owner";

export type MemberInput = {
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  role: StaffRole;
  level: StaffLevel | null;
  service_ids: string[];
  // Only when the form had the weekly hours (adding someone).
  hours?: WeeklyHoursRow[];
};

export type MemberErrors = Partial<Record<"first_name" | "email" | "phone" | "role" | "hours", string>> & { days?: Partial<Record<Weekday, string>> };

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const text = (form: FormLike, name: string) => String(form.get(name) ?? "").trim();

export function parseMemberForm(form: FormLike, allowed: readonly StaffRole[]): { ok: true; input: MemberInput } | { ok: false; errors: MemberErrors } {
  const errors: MemberErrors = {};
  const first = text(form, "first_name");
  const email = text(form, "email").toLowerCase();
  const phoneText = text(form, "phone");
  const role = text(form, "role") as StaffRole;
  const levelText = text(form, "level");
  if (!first) errors.first_name = "Enter their first name.";
  if (first.length > 60) errors.first_name = "Keep the name under 60 characters.";
  if (email && !EMAIL.test(email)) errors.email = "Enter a valid email address.";
  const phone = phoneText ? normalizePhone(phoneText) : null;
  if (phoneText && !phone) errors.phone = "Enter a 10-digit phone number.";
  if (!allowed.includes(role)) errors.role = "Choose a role.";
  // A level is for stylists only.
  const level = role === "stylist" && (STAFF_LEVELS as readonly string[]).includes(levelText) ? (levelText as StaffLevel) : null;
  const service_ids = [...new Set(form.getAll("service_ids").map(String).filter(isUuid))];
  let hours: WeeklyHoursRow[] | undefined;
  if (form.get("hours_included")) {
    const parsed = parseWeeklyHoursForm(form);
    if (parsed.ok) hours = parsed.hours;
    else {
      errors.hours = "Fix the highlighted days.";
      errors.days = parsed.errors;
    }
  }
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, input: { first_name: first, last_name: text(form, "last_name").slice(0, 60), email: email || null, phone, role, level, service_ids, ...(hours ? { hours } : {}) } };
}

export type LoginState = "none" | "invited" | "active";

// No login yet; invited (a login, never signed in); or signs in.
export function loginState(login: { last_sign_in_at: string | null } | null | undefined): LoginState {
  if (!login) return "none";
  return login.last_sign_in_at ? "active" : "invited";
}

export const LOGIN_LABELS: Record<LoginState, string> = { none: "No login", invited: "Invited", active: "Signs in" };
