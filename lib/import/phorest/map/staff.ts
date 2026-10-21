import type { IssueLog } from "../issues.ts";
import type { StaffLevel, StaffRecord, StaffRole } from "../model.ts";
import type { PhorestStaff } from "../types.ts";
import { email, phone, text } from "./common.ts";

// Phorest staff categories are free text set by each salon ("Senior
// Stylist", "Reception", ...). Infer role and level from common words.
export function roleFromCategory(category: string | null): StaffRole {
  const c = (category ?? "").toLowerCase();
  if (/manager/.test(c)) return "manager";
  if (/recep|front|desk|coordinator|concierge|admin/.test(c)) return "front_desk";
  return "stylist";
}

export function levelFromCategory(category: string | null): StaffLevel | null {
  const c = (category ?? "").toLowerCase();
  if (/junior|graduate|apprentice|assistant|trainee/.test(c)) return "junior";
  if (/master|director|creative|educator|artistic/.test(c)) return "master";
  if (/senior/.test(c)) return "senior";
  return null;
}

export function mapStaff(s: PhorestStaff, locationExternalId: string, log: IssueLog): StaffRecord | null {
  const externalId = text(s.staffId);
  if (!externalId) {
    log.add("staff", "staffId", "skipped", "missing");
    return null;
  }
  let first = text(s.firstName);
  let last = text(s.lastName) ?? "";
  if (!first) {
    if (!last) {
      log.add("staff", "firstName", "skipped", "no first or last name");
      return null;
    }
    log.add("staff", "firstName", "adjusted", "missing; used the last name");
    [first, last] = [last, ""];
  }

  const category = text(s.staffCategoryName);
  const role = roleFromCategory(category);
  const level = role === "stylist" ? levelFromCategory(category) : null;
  if (!category) log.add("staff", "staffCategoryName", "review", "missing; imported as a stylist");

  return {
    externalId,
    locationExternalId,
    first_name: first,
    last_name: last,
    email: email(s.email, log, "staff"),
    phone: phone(s.mobile, log, "staff"),
    role,
    level,
    is_active: s.archived !== true,
  };
}
