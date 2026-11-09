"use server";

import { isUuid } from "@/lib/ids";
import { hashKey, requestInfo, withinLimits } from "@/lib/online-booking/security";
import { loadSite, type BookingSite } from "@/lib/online-booking/site";
import { PHOTO_MAX_BYTES, sniffImage } from "@/lib/photos";
import { loadBookingContext } from "@/lib/scheduling/load";
import { visitTimes } from "@/lib/scheduling/online";
import { addDays, fromLocal, todayIn } from "@/lib/scheduling/time";
import { extraTimeFlag, MAX_QUIZ_PHOTOS, rankStylists, readAnswers, SOON_DAYS, suggestService } from "@/lib/stylist-quiz";
import { createAdminClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createAdminClient>;

export type QuizMatch = { id: string; name: string; photoUrl: string | null; cents: number; reasons: string[] };
export type QuizResult =
  | { ok: true; quizId: string; photoKey: string; service: { id: string; name: string; minutes: number }; consultation: boolean; stylists: QuizMatch[] }
  | { ok: false; message: string };

const photoKeyFor = (quizId: string) => hashKey(`quiz-photos:${quizId}`);
const PHOTO_WINDOW_MS = 3_600_000;

async function openQuiz(admin: Admin, slug: string): Promise<BookingSite | null> {
  const found = await loadSite(admin, slug);
  return found.status === "open" && found.site.settings.quizOn ? found.site : null;
}

// How many days until each stylist first has time for the service, by the
// booking rules (null: none in the next two weeks).
async function daysUntilFree(admin: Admin, site: BookingSite, serviceId: string, stylistIds: string[]) {
  const tz = site.location.timezone;
  const now = new Date();
  const today = todayIn(tz, now);
  const days = Math.min(SOON_DAYS, site.settings.windowDays + 1);
  const notBefore = new Date(now.getTime() + site.settings.noticeMinutes * 60_000);
  const notAfter = fromLocal(addDays(today, site.settings.windowDays + 1), 0, tz) ?? undefined;
  const ctx = await loadBookingContext(admin, { id: site.location.id, timezone: tz }, today, addDays(today, days - 1));
  const out = new Map<string, number | null>();
  for (const staffId of stylistIds) {
    out.set(staffId, null);
    for (let d = 0; d < days; d++) {
      if (visitTimes(ctx, { serviceIds: [serviceId], staffId, stylistIds: [staffId] }, addDays(today, d), { notBefore, notAfter }).length) {
        out.set(staffId, d);
        break;
      }
    }
  }
  return out;
}

export async function submitQuiz(slug: string, input: unknown, website: string): Promise<QuizResult> {
  const admin = createAdminClient();
  const site = await openQuiz(admin, slug);
  if (!site) return { ok: false, message: "This isn't available right now." };
  if (website) return { ok: false, message: "Something went wrong. Please call the salon." };
  const { ipHash } = await requestInfo();
  if (!(await withinLimits(admin, [{ key: `quiz:ip:${ipHash}`, limit: 20, windowSeconds: 3600 }]))) {
    return { ok: false, message: "That's a lot of tries. Please wait a few minutes." };
  }
  const answers = readAnswers(input, [...new Set(site.services.map((s) => s.category))]);
  if (!answers) return { ok: false, message: "Answer each question to see your match." };
  const settings = { consultationServiceId: site.settings.consultationServiceId, patchTestServiceId: site.patchTest.serviceId };
  const suggested = suggestService(site.services, answers, settings);
  if (!suggested) return { ok: false, message: "We can't book that online. Please call the salon and we'll help." };
  const offering = site.stylists.filter((s) => suggested.service.id in s.prices);
  const free = await daysUntilFree(admin, site, suggested.service.id, offering.map((s) => s.id));
  const matches = rankStylists(site.stylists, suggested.service, answers, site.levels, free);
  if (!matches.length) return { ok: false, message: "We can't book that online. Please call the salon and we'll help." };
  const flag = extraTimeFlag(answers, suggested, site.services);
  const { data, error } = await admin
    .from("stylist_quizzes")
    .insert({ business_id: site.business.id, answers: answers as never, service_id: suggested.service.id, staff_ids: matches.map((m) => m.stylist.id), flag_minutes: flag?.minutes ?? null, flag_reasons: flag?.reasons ?? [] })
    .select("id")
    .single();
  if (error) throw error;
  return {
    ok: true,
    quizId: data.id,
    photoKey: photoKeyFor(data.id),
    service: { id: suggested.service.id, name: suggested.service.name, minutes: suggested.service.minutes },
    consultation: suggested.consultation,
    stylists: matches.map((m) => ({ id: m.stylist.id, name: m.stylist.displayName, photoUrl: site.stylists.find((s) => s.id === m.stylist.id)?.photoUrl ?? null, cents: m.cents, reasons: m.reasons })),
  };
}

// One photo for the quiz this browser just sent, shrunk there first.
export async function addQuizPhoto(quizId: string, photoKey: string, formData: FormData): Promise<{ ok: boolean }> {
  if (!isUuid(quizId) || photoKey !== photoKeyFor(quizId)) return { ok: false };
  const file = formData.get("photo");
  if (!(file instanceof File) || file.size === 0 || file.size > PHOTO_MAX_BYTES) return { ok: false };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = sniffImage(bytes);
  if (!type) return { ok: false };
  const admin = createAdminClient();
  const { data: quiz } = await admin.from("stylist_quizzes").select("business_id, created_at, photo_paths").eq("id", quizId).maybeSingle();
  if (!quiz || Date.now() - new Date(quiz.created_at).getTime() > PHOTO_WINDOW_MS || quiz.photo_paths.length >= MAX_QUIZ_PHOTOS) return { ok: false };
  const path = `${quiz.business_id}/${quizId}/${crypto.randomUUID()}.${type.ext}`;
  const upload = await admin.storage.from("quiz-photos").upload(path, bytes, { contentType: type.contentType, upsert: false });
  if (upload.error) return { ok: false };
  const { error } = await admin.from("stylist_quizzes").update({ photo_paths: [...quiz.photo_paths, path] }).eq("id", quizId);
  if (error) {
    await admin.storage.from("quiz-photos").remove([path]);
    return { ok: false };
  }
  return { ok: true };
}
