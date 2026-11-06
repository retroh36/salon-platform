// Running a client report (./client-reports.ts) with the signed-in person's
// own login, so RLS decides what they see, and the salon's menu and team
// for reading and describing one.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { fromLocal, toLocal, type LocalDate } from "@/lib/scheduling/time";
import { minVisitsOf, REPORT_LIMIT, resolveDate, type ClientReport, type ReportRow } from "./client-reports";

type Supabase = SupabaseClient<Database>;

export type ReportMenu = {
  categories: string[];
  services: { id: string; name: string; category: string }[];
  stylists: { id: string; firstName: string; name: string }[];
};

export async function loadReportMenu(supabase: Supabase, businessId: string): Promise<ReportMenu> {
  const [services, staff] = await Promise.all([
    supabase.from("services").select("id, name, category").eq("business_id", businessId).is("archived_at", null).order("category").order("name"),
    // Everyone who does services, those who've left too (their clients are
    // worth a list).
    supabase.from("staff").select("id, first_name, last_name, staff_services!inner(service_id)").eq("business_id", businessId).order("first_name").order("last_name"),
  ]);
  if (services.error) throw services.error;
  if (staff.error) throw staff.error;
  return {
    categories: [...new Set(services.data.map((s) => s.category))],
    services: services.data,
    stylists: staff.data.map((s) => ({ id: s.id, firstName: s.first_name, name: `${s.first_name} ${s.last_name}` })),
  };
}

export const knownOf = (menu: ReportMenu) => ({ categories: menu.categories, serviceIds: menu.services.map((s) => s.id), staffIds: menu.stylists.map((s) => s.id) });

export const namesOf = (menu: ReportMenu) => ({ services: new Map(menu.services.map((s) => [s.id, s.name])), staff: new Map(menu.stylists.map((s) => [s.id, s.firstName])) });

export async function runClientReport(
  supabase: Supabase,
  where: { businessId: string; timezone: string; today: LocalDate },
  r: ClientReport,
  options: { spend: boolean; limit?: number },
): Promise<{ rows: ReportRow[]; total: number }> {
  const at = (ref: string | null) => {
    const day = ref ? resolveDate(ref, where.today) : null;
    return day ? (fromLocal(day, 0, where.timezone)?.toISOString() ?? null) : null;
  };
  const { data, error } = await supabase.rpc("client_report", {
    p_business_id: where.businessId,
    p_categories: r.categories,
    p_service_ids: r.serviceIds,
    p_staff_ids: r.staffIds,
    p_from: at(r.from) as string,
    p_to: at(r.to) as string,
    p_min: minVisitsOf(r),
    p_max: r.maxVisits as number,
    p_no_visit_since: at(r.noVisitSince) as string,
    p_visited_since: at(r.visitedSince) as string,
    p_next: r.nextVisit as string,
    p_min_spend: (options.spend ? r.minSpendCents : null) as number,
    p_sort: r.sort,
    p_limit: options.limit ?? REPORT_LIMIT,
  });
  if (error) throw error;
  const day = (iso: string | null) => (iso ? toLocal(new Date(iso), where.timezone).date : null);
  return {
    total: Number(data[0]?.total ?? 0),
    rows: data.map((c) => ({
      id: c.id,
      firstName: c.first_name,
      lastName: c.last_name,
      phone: c.phone,
      visits: c.visits,
      lastVisit: day(c.last_visit_at),
      nextVisit: day(c.next_visit_at),
      usualStylist: c.usual_staff_name,
      spendCents: options.spend && c.spend_cents !== null ? Number(c.spend_cents) : null,
    })),
  };
}
