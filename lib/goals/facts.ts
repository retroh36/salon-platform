// The real data behind Denise's goal suggestions (./wording.ts
// goalActions), for one stylist: their regulars due back with nothing
// booked, open gaps of an hour or more this week, and clients booked with
// them soon who usually buy retail. First names only.

import type { SupabaseClient } from "@supabase/supabase-js";
import { gapsWorthFilling } from "@/lib/dashboard";
import { loadDueBack, type DashboardMe } from "@/lib/dashboard-load";
import type { Database } from "@/lib/database.types";
import { loadClientInsights } from "@/lib/insights/read";
import { loadBookingContext, startOfLocalDay } from "@/lib/scheduling/load";
import { addDays, datesBetween, toLocal, weekdayOf, type LocalDate } from "@/lib/scheduling/time";
import type { ActionFacts } from "./wording";

type Supabase = SupabaseClient<Database>;

const WEEKDAYS = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
export const dayLabel = (date: LocalDate, today: LocalDate) => (date === today ? "today" : date === addDays(today, 1) ? "tomorrow" : WEEKDAYS[weekdayOf(date)]);

// Clients who buy retail on at least this share of visits.
const RETAIL_BUYER = 0.4;

export async function loadGoalFacts(
  supabase: Supabase,
  me: Pick<DashboardMe, "business_id" | "location">,
  staffId: string,
  upcomingVisits: number,
  now = new Date(),
): Promise<ActionFacts> {
  const tz = me.location.timezone;
  const local = toLocal(now, tz);
  const end = addDays(local.date, 6);
  const [due, ctx, booked] = await Promise.all([
    loadDueBack(supabase, { id: staffId, role: "stylist", business_id: me.business_id, location: me.location }, 3),
    loadBookingContext(supabase, me.location, local.date, end),
    supabase
      .from("appointment_items")
      .select("starts_at, appointment:appointments!inner(client_id, status)")
      .eq("staff_id", staffId)
      .in("appointment.status", ["booked", "confirmed"])
      .gte("starts_at", now.toISOString())
      .lt("starts_at", startOfLocalDay(addDays(end, 1), tz).toISOString())
      .order("starts_at"),
  ]);
  if (booked.error) throw booked.error;

  const gaps = datesBetween(local.date, end)
    .flatMap((date) => gapsWorthFilling(ctx, [staffId], date, date === local.date ? local.minute : 0))
    .sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start)
    .map((g) => ({ date: g.date, start: g.start, end: g.end, dayLabel: dayLabel(g.date, local.date) }));

  // Their first visit in the week for each client who usually buys retail.
  const firstVisit = new Map<string, LocalDate>();
  for (const b of booked.data) if (b.appointment.client_id && !firstVisit.has(b.appointment.client_id)) firstVisit.set(b.appointment.client_id, toLocal(new Date(b.starts_at), tz).date);
  const insights = firstVisit.size ? await loadClientInsights(supabase, me.business_id, [...firstVisit.keys()]) : new Map();
  const buyers = [...firstVisit.entries()].filter(([id]) => (insights.get(id)?.habits.retailRate ?? 0) >= RETAIL_BUYER);
  const { data: names, error } = buyers.length ? await supabase.from("clients").select("id, first_name").in("id", buyers.map(([id]) => id)) : { data: [], error: null };
  if (error) throw error;
  const first = new Map(names.map((c) => [c.id, c.first_name]));

  return {
    overdue: due.overdue.map((o) => ({ name: o.name.split(" ")[0], reason: o.reason })),
    overdueTotal: due.overdueTotal,
    gaps,
    retailClients: buyers.flatMap(([id, date]) => (first.has(id) ? [{ name: first.get(id)!, dayLabel: dayLabel(date, local.date) }] : [])),
    upcomingVisits,
  };
}
