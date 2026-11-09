// A booked visit's "Find my stylist" answers, for booking details, read with
// the person's own login, so RLS decides who sees them.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { answerLines, type QuizAnswers } from "@/lib/stylist-quiz";

export type VisitQuiz = {
  id: string;
  lines: { label: string; value: string }[];
  photos: string[];
  flag: { minutes: number; reasons: string[]; status: "accepted" | "ignored" | null } | null;
};

const SIGNED_SECONDS = 3600;

export async function loadVisitQuizzes(supabase: SupabaseClient<Database>, visitIds: readonly string[]): Promise<Map<string, VisitQuiz>> {
  const out = new Map<string, VisitQuiz>();
  if (!visitIds.length) return out;
  const { data, error } = await supabase.from("stylist_quizzes").select("id, appointment_id, answers, photo_paths, flag_minutes, flag_reasons, flag_status").in("appointment_id", [...visitIds]);
  if (error) throw error;
  const paths = data.flatMap((q) => q.photo_paths);
  const signed = paths.length ? ((await supabase.storage.from("quiz-photos").createSignedUrls(paths, SIGNED_SECONDS)).data ?? []) : [];
  const urls = new Map(signed.filter((s) => s.signedUrl).map((s) => [s.path, s.signedUrl]));
  for (const q of data) {
    out.set(q.appointment_id!, {
      id: q.id,
      lines: answerLines(q.answers as unknown as QuizAnswers),
      photos: q.photo_paths.flatMap((p) => urls.get(p) ?? []),
      flag: q.flag_minutes ? { minutes: q.flag_minutes, reasons: q.flag_reasons, status: q.flag_status as "accepted" | "ignored" | null } : null,
    });
  }
  return out;
}
