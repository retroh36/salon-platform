"use server";

import { revalidatePath } from "next/cache";
import { getCurrentStaff } from "@/lib/auth";
import { isFrontOfHouse } from "@/lib/staff";
import { isUuid } from "@/lib/ids";
import { describeProblem } from "@/lib/scheduling/booking";
import { saveBooking } from "@/lib/scheduling/book";

export type QuizFlagResult = { ok: true } | { ok: false; message: string };

// Staff accept our extra-time flag: the visit's last service gets longer,
// through the booking rules, then who accepted it is recorded. Refused
// (someone's booked after it), the flag stays to ignore or sort out.
export async function acceptQuizFlag(quizId: string): Promise<QuizFlagResult> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !isFrontOfHouse(me.role) || !isUuid(quizId)) return { ok: false, message: "Only the front of house can change this." };
  const { data: quiz } = await supabase.from("stylist_quizzes").select("appointment_id, flag_minutes, flag_status").eq("id", quizId).maybeSingle();
  if (!quiz?.appointment_id || !quiz.flag_minutes || quiz.flag_status) return { ok: false, message: "This has already been decided." };
  const { data: visit, error } = await supabase
    .from("appointments")
    .select("id, client_id, notes, appointment_items(id, service_id, staff_id, resource_id, starts_at, active_minutes, processing_minutes, finishing_minutes)")
    .eq("id", quiz.appointment_id)
    .single();
  if (error) throw error;
  const items = [...visit.appointment_items].sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const last = items[items.length - 1];
  const result = await saveBooking(supabase, me.location, {
    appointmentId: visit.id,
    clientId: visit.client_id,
    notes: visit.notes,
    items: items.map((i) => ({
      id: i.id,
      serviceId: i.service_id,
      staffId: i.staff_id,
      start: new Date(i.starts_at),
      // Their chair if it's still free for the longer time, else another.
      resource: { kind: "any", prefer: i.resource_id } as const,
      ...(i.id === last.id ? { minutes: i.active_minutes + i.processing_minutes + i.finishing_minutes + quiz.flag_minutes! } : {}),
    })),
  });
  if (!result.ok) return { ok: false, message: result.error === "invalid" ? (result.problems.flat().map(describeProblem)[0] ?? "That extra time doesn't fit.") : "The calendar changed. Try again." };
  const decided = await supabase.rpc("decide_quiz_flag", { p_quiz_id: quizId, p_decision: "accepted" });
  if (decided.error) return { ok: false, message: "The time was added, but we couldn't record it. Reload to check." };
  revalidatePath("/calendar");
  return { ok: true };
}

export async function ignoreQuizFlag(quizId: string): Promise<QuizFlagResult> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !isUuid(quizId)) return { ok: false, message: "Only the front of house can change this." };
  const { error } = await supabase.rpc("decide_quiz_flag", { p_quiz_id: quizId, p_decision: "ignored" });
  if (error) return { ok: false, message: error.hint === "decided" ? "This has already been decided." : "That didn't save. Try again." };
  revalidatePath("/calendar");
  return { ok: true };
}
