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
