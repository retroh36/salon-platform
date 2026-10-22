// Everything Ask Denise needs for one question (./assistant.ts), for the
// staff member asking: the menu, the stylists, the calendar, proposals,
// and what they may look up (./knowledge.ts). Used by the calendar's "Ask
// Denise" and the evaluation script (scripts/denise-eval).

import type { SupabaseClient } from "@supabase/supabase-js";
import { canBook } from "@/lib/appointments";
import type { Database } from "@/lib/database.types";
import { recordProposals } from "@/lib/scheduling/ai-actions";
import type { BookingContext } from "@/lib/scheduling/booking";
import { loadBookingContext, loadOffers } from "@/lib/scheduling/load";
import { LEVEL_LABELS } from "@/lib/schedule-forms";
import type { LocalDate } from "@/lib/scheduling/time";
import type { StaffRole } from "@/lib/staff";
import type { AssistantContext } from "./assistant";
import { loadDurations } from "@/lib/insights/read";
import { knowledgeFor } from "./knowledge";

type Supabase = SupabaseClient<Database>;

export type Asking = {
  role: StaffRole;
  staffId: string;
  businessId: string;
  location: { id: string; timezone: string };
  salon: string;
  today: LocalDate;
};

const ROLE_NAMES = { owner: "owner", manager: "manager", front_desk: "front desk", stylist: "stylist" } as const;

export async function assistantContext(supabase: Supabase, me: Asking, date: LocalDate, now = new Date()): Promise<AssistantContext> {
  const [services, staff] = await Promise.all([
    supabase.from("services").select("id, name, category, duration_minutes").is("archived_at", null).order("name"),
    supabase.from("staff").select("id, first_name, role, level").eq("location_id", me.location.id).eq("is_active", true),
  ]);
  if (services.error) throw services.error;
  if (staff.error) throw staff.error;
  const [offers, learned] = await Promise.all([loadOffers(supabase, staff.data.map((m) => m.id)), loadDurations(supabase, me.businessId)]);
  const calendars = new Map<string, Promise<BookingContext>>();
  const bookers = canBook(me.role);

  return {
    salon: me.salon,
    timeZone: me.location.timezone,
    today: me.today,
    date,
    now,
    services: services.data.map((sv) => ({ id: sv.id, name: sv.name, category: sv.category, minutes: sv.duration_minutes ?? 0 })),
    staff: staff.data
      .filter((m) => (offers.get(m.id)?.size ?? 0) > 0)
      .map((m) => ({ id: m.id, firstName: m.first_name, title: m.level ? `${LEVEL_LABELS[m.level]} stylist` : m.role })),
    calendar: (day) => {
      if (!calendars.has(day)) calendars.set(day, loadBookingContext(supabase, me.location, day, day));
      return calendars.get(day)!;
    },
    propose: async (b) => {
      if (!bookers) return null;
      const [id] = await recordProposals(supabase, me.location.id, {
        feature: "ask_denise",
        subject: null,
        options: [{ summary: b.summary, reason: b.reason, proposal: { changes: [], book: { clientId: null, items: [{ serviceId: b.serviceId, staffId: b.staffId, resourceId: b.resourceId, start: b.start, timing: b.timing }] } } }],
      });
      return id ?? null;
    },
    usualTime: (staffId, serviceId) => {
      const d = learned.get(`${staffId}:${serviceId}`);
      return d?.trusted ? { medianMinutes: d.medianMinutes, visits: d.visits } : null;
    },
    asker: ROLE_NAMES[me.role],
    askerName: staff.data.find((m) => m.id === me.staffId)?.first_name,
    knowledge: knowledgeFor(supabase, me),
  };
}
