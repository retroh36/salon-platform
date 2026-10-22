"use server";

import { revalidatePath } from "next/cache";
import { canBook } from "@/lib/appointments";
import { getCurrentStaff } from "@/lib/auth";
import { normalizePhone } from "@/lib/clients";
import { isUuid } from "@/lib/ids";
import { addDays, isLocalDate, todayIn } from "@/lib/scheduling/time";
import { TIME_WINDOWS, type WindowName } from "@/lib/scheduling/waitlist";
import { bookWalkIn, walkInQueueFor, type WalkInRow } from "@/lib/waitlist-book";

const NOT_ALLOWED = "Only the front desk, managers and owners can do that.";
export type Result = { ok: true; message?: string } | { ok: false; message: string };

async function frontOfHouse() {
  const { supabase, staff: me } = await getCurrentStaff();
  return me && canBook(me.role) ? { supabase, me } : null;
}

export type WaitlistInput = { clientId: string; serviceIds: string[]; staffIds: string[]; fromDate: string; toDate: string; windows: string[]; notes: string };

export async function addToWaitlist(input: WaitlistInput): Promise<Result> {
  const s = await frontOfHouse();
  if (!s) return { ok: false, message: NOT_ALLOWED };
  const today = todayIn(s.me.location.timezone);
  if (!isUuid(input.clientId)) return { ok: false, message: "Choose a client." };
  const serviceIds = [...new Set(input.serviceIds.filter(isUuid))];
  if (!serviceIds.length || serviceIds.length > 5) return { ok: false, message: "Choose one to five services." };
  const staffIds = [...new Set(input.staffIds.filter(isUuid))];
  if (!isLocalDate(input.fromDate) || !isLocalDate(input.toDate) || input.toDate < input.fromDate) return { ok: false, message: "Choose the dates the client can come." };
  if (input.toDate < today) return { ok: false, message: "Those dates have passed." };
  if (input.toDate > addDays(input.fromDate, 92)) return { ok: false, message: "Choose dates up to three months apart." };
  const windows = input.windows.filter((w): w is WindowName => w in TIME_WINDOWS);
  const { error } = await s.supabase.from("waitlist_entries").insert({
    business_id: s.me.business_id,
    location_id: s.me.location.id,
    client_id: input.clientId,
    service_ids: serviceIds,
    staff_ids: staffIds,
    from_date: input.fromDate < today ? today : input.fromDate,
    to_date: input.toDate,
    windows,
    notes: input.notes.trim().slice(0, 500) || null,
    created_by: s.me.id,
  });
  if (error?.code === "42501") return { ok: false, message: NOT_ALLOWED };
  if (error?.code === "23503") return { ok: false, message: "That client doesn't exist." };
  if (error) throw error;
  revalidatePath("/calendar", "layout");
  return { ok: true };
}

export async function removeFromWaitlist(entryId: string): Promise<Result> {
  const s = await frontOfHouse();
  if (!s) return { ok: false, message: NOT_ALLOWED };
  if (!isUuid(entryId)) return { ok: false, message: "That entry doesn't exist." };
  const { data, error } = await s.supabase.from("waitlist_entries").update({ status: "removed" }).eq("id", entryId).eq("status", "waiting").select("id");
  if (error) throw error;
  if (!data.length) return { ok: false, message: "That client is no longer on the waitlist." };
  revalidatePath("/calendar", "layout");
  return { ok: true };
}

export type WalkInView = WalkInRow;

export async function walkIns(): Promise<WalkInView[]> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me) return [];
  return walkInQueueFor(supabase, me.location, todayIn(me.location.timezone), new Date());
}

export async function addWalkIn(input: { name: string; phone: string; serviceId: string }): Promise<Result> {
  const s = await frontOfHouse();
  if (!s) return { ok: false, message: NOT_ALLOWED };
  const name = input.name.trim().slice(0, 100);
  if (!name) return { ok: false, message: "Enter the client's name." };
  const phone = input.phone.trim() ? normalizePhone(input.phone) : null;
  if (input.phone.trim() && !phone) return { ok: false, message: "Enter a 10-digit phone number, or leave it blank." };
  if (!isUuid(input.serviceId)) return { ok: false, message: "Choose a service." };
  const { error } = await s.supabase.from("walk_ins").insert({ business_id: s.me.business_id, location_id: s.me.location.id, name, phone, service_id: input.serviceId, created_by: s.me.id });
  if (error?.code === "42501") return { ok: false, message: NOT_ALLOWED };
  if (error?.code === "23503") return { ok: false, message: "That service doesn't exist." };
  if (error) throw error;
  return { ok: true };
}

export async function walkInLeft(walkInId: string): Promise<Result> {
  const s = await frontOfHouse();
  if (!s) return { ok: false, message: NOT_ALLOWED };
  if (!isUuid(walkInId)) return { ok: false, message: "That walk-in doesn't exist." };
  const { error } = await s.supabase.from("walk_ins").update({ status: "left" }).eq("id", walkInId).eq("status", "waiting");
  if (error) throw error;
  return { ok: true };
}

export async function bookWalkInNow(walkInId: string): Promise<Result & { appointmentId?: string }> {
  const s = await frontOfHouse();
  if (!s) return { ok: false, message: NOT_ALLOWED };
  if (!isUuid(walkInId)) return { ok: false, message: "That walk-in doesn't exist." };
  const result = await bookWalkIn(s.supabase, { ...s.me.location, businessId: s.me.business_id }, walkInId, todayIn(s.me.location.timezone), new Date());
  if (result.ok) revalidatePath("/calendar", "layout");
  return result;
}
