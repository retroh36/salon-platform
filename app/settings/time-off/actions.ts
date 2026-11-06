"use server";

import { revalidatePath } from "next/cache";
import { getCurrentStaff } from "@/lib/auth";
import { isUuid } from "@/lib/ids";
import { can } from "@/lib/permissions";
import { addDays, isLocalDate } from "@/lib/scheduling/time";

export type TimeOffSettingsState = { ok?: boolean; message?: string } | undefined;
const NO = "Only those who can change settings can change time-off rules.";

async function settings() {
  const { supabase, staff: me } = await getCurrentStaff();
  return me && can(me, "settings") ? { supabase, me } : null;
}

function refresh() {
  revalidatePath("/settings/time-off");
  revalidatePath("/time-off");
  revalidatePath("/scheduling/requests");
}

export async function saveNoticeDays(_prev: TimeOffSettingsState, form: FormData): Promise<TimeOffSettingsState> {
  const s = await settings();
  if (!s) return { message: NO };
  const days = Number(form.get("notice_days"));
  if (!Number.isInteger(days) || days < 0 || days > 365) return { message: "Enter a number of days from 0 to 365." };
  const { data, error } = await s.supabase.from("businesses").update({ time_off_notice_days: days }).eq("id", s.me.business_id).select("id");
  if (error) throw error;
  if (!data.length) return { message: NO };
  refresh();
  return { ok: true, message: "Saved." };
}

export async function addBlackout(_prev: TimeOffSettingsState, form: FormData): Promise<TimeOffSettingsState> {
  const s = await settings();
  if (!s) return { message: NO };
  const startsOn = String(form.get("starts_on") ?? "");
  const endsOn = String(form.get("ends_on") ?? "") || startsOn;
  const label = String(form.get("label") ?? "").trim();
  if (!isLocalDate(startsOn)) return { message: "Choose the first day." };
  if (!isLocalDate(endsOn) || endsOn < startsOn) return { message: "The last day can't be before the first." };
  if (endsOn > addDays(startsOn, 366)) return { message: "Keep it to a year or less." };
  if (label.length > 80) return { message: "Keep the name under 80 characters." };
  const { error } = await s.supabase.from("time_off_blackouts").insert({ business_id: s.me.business_id, starts_on: startsOn, ends_on: endsOn, label: label || null, created_by: s.me.id });
  if (error?.code === "42501") return { message: NO };
  if (error) throw error;
  refresh();
  return { ok: true, message: "Blackout added." };
}

export async function removeBlackout(id: string) {
  const s = await settings();
  if (!s || !isUuid(id)) return;
  const { error } = await s.supabase.from("time_off_blackouts").delete().eq("id", id);
  if (error) throw error;
  refresh();
}

export type TypeInput = { id: string | null; name: string; reason: "vacation" | "sick" | "personal" | "other"; usesPto: boolean };
const REASONS = ["vacation", "sick", "personal", "other"] as const;
const TYPE_HINTS: Record<string, string> = {
  empty: "Keep at least one type of time off.",
  too_many: "Keep it to 12 types.",
  name: "Give each type a name of 40 characters or less.",
  duplicate: "Two types have the same name.",
  stale: "Those types changed since you opened the page. Reload and try again.",
};

// The salon's types of time off, the whole list in order. Types taken out
// stay on time off already saved under them.
export async function saveTimeOffTypes(types: TypeInput[]): Promise<TimeOffSettingsState> {
  const s = await settings();
  if (!s) return { message: NO };
  if (!Array.isArray(types) || types.some((t) => (t.id !== null && !isUuid(t.id)) || !REASONS.includes(t.reason) || typeof t.name !== "string")) return { message: "Check the types." };
  const { error } = await s.supabase.rpc("save_time_off_types", {
    p_business_id: s.me.business_id,
    p_types: types.map((t) => ({ id: t.id, name: t.name.trim(), reason: t.reason, uses_pto: t.usesPto === true })),
  });
  if (error?.code === "42501") return { message: NO };
  if (error?.code === "22023") return { message: TYPE_HINTS[error.hint ?? ""] ?? error.message };
  if (error) throw error;
  refresh();
  revalidatePath("/scheduling/balances");
  return { ok: true, message: "Types saved." };
}

const ROLES = ["owner", "manager", "front_desk", "stylist", "assistant", "bookkeeper"] as const;
const hoursField = (form: FormData, name: string) => {
  const raw = String(form.get(name) ?? "").trim();
  if (raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 60) : NaN;
};

// The PTO policy: how it's earned, the year, carry-over and the cap.
export async function savePtoPolicy(_prev: TimeOffSettingsState, form: FormData): Promise<TimeOffSettingsState> {
  const s = await settings();
  if (!s) return { message: NO };
  const accrual = String(form.get("accrual"));
  const carryOver = String(form.get("carry_over"));
  const yearly = hoursField(form, "yearly_hours");
  const earn = hoursField(form, "earn_hours");
  const perHours = Number(form.get("per_hours"));
  const period = hoursField(form, "period_hours");
  const carry = hoursField(form, "carry_hours");
  const cap = hoursField(form, "cap_hours");
  const month = Number(form.get("year_start_month"));
  const trackingFrom = String(form.get("tracking_from") ?? "");
  const roles = ROLES.filter((r) => form.get(`role_${r}`));

  if (!["yearly", "per_hour", "per_period"].includes(accrual)) return { message: "Choose how PTO is earned." };
  if (!["all", "none", "up_to"].includes(carryOver)) return { message: "Choose what carries over." };
  if (accrual === "yearly" && (yearly === null || Number.isNaN(yearly) || yearly > 2000 * 60)) return { message: "Enter the hours a year, up to 2,000." };
  if (accrual === "per_hour" && (earn === null || Number.isNaN(earn) || earn < 1 || earn > 600 || !Number.isInteger(perHours) || perHours < 1 || perHours > 400))
    return { message: "Enter the hours earned (up to 10) for every so many hours worked (1 to 400)." };
  if (accrual === "per_period" && (period === null || Number.isNaN(period) || period > 100 * 60)) return { message: "Enter the hours a pay period, up to 100." };
  if (carryOver === "up_to" && (carry === null || Number.isNaN(carry) || carry > 2000 * 60)) return { message: "Enter the hours that carry over." };
  if (cap !== null && (Number.isNaN(cap) || cap < 60 || cap > 4000 * 60)) return { message: "Enter a cap of at least 1 hour, or leave it blank." };
  if (!Number.isInteger(month) || month < 1 || month > 12) return { message: "Choose the month the PTO year starts." };
  if (!isLocalDate(trackingFrom)) return { message: "Choose the day balances start from." };
  if (!roles.length) return { message: "Choose who earns PTO." };

  const { error } = await s.supabase.rpc("save_pto_policy", {
    p_business_id: s.me.business_id,
    p_policy: {
      is_on: form.get("is_on") === "on",
      accrual,
      yearly_minutes: yearly ?? 0,
      prorate_first_year: form.get("prorate") === "on",
      earn_minutes: earn ?? 60,
      per_hours: Number.isInteger(perHours) && perHours > 0 ? perHours : 30,
      period_minutes: period ?? 0,
      year_start_month: month,
      carry_over: carryOver,
      carry_minutes: carry ?? 0,
      cap_minutes: cap,
      tracking_from: trackingFrom,
      roles,
    },
  });
  if (error?.code === "42501") return { message: NO };
  if (error?.code === "22023") return { message: error.message };
  if (error) throw error;
  refresh();
  revalidatePath("/scheduling/balances");
  return { ok: true, message: "PTO policy saved." };
}
