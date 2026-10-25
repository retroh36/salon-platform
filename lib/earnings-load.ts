// Loading a stylist's live earnings for My day (worked out in ./earnings.ts
// from payroll's own tickets): this pay period, this week (Monday to
// Sunday) and today, with an estimate for visits checked in but not yet
// checked out, and how far their next tier is.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { nextTierText, type PlanRules } from "./commission";
import { estimates, totalsBetween, windowBasis, type Estimate, type Totals } from "./earnings";
import { periodContaining, tierWindow, windowsFrom, type PayPeriod, type Ticket } from "./payroll";
import { loadPaySettings, loadPayroll, planVersions } from "./payroll-load";
import { startOfLocalDay } from "./scheduling/load";
import { addDays, todayIn, toLocal, weekdayOf, type LocalDate } from "./scheduling/time";

type Supabase = SupabaseClient<Database>;

export type LiveEarnings = {
  planName: string | null;
  // Today's sales that paid them, newest first.
  sales: Ticket[];
  estimates: Estimate[];
  today: Totals;
  week: Totals;
  period: Totals & { range: PayPeriod };
  estimatedCents: number;
  nextTier: string | null;
};

export async function loadLiveEarnings(supabase: Supabase, me: { id: string; business_id: string; location: { id: string; timezone: string } }): Promise<LiveEarnings> {
  const tz = me.location.timezone;
  const today = todayIn(tz);
  const dayOf = (iso: string) => toLocal(new Date(iso), tz).date;
  const [settings, comp, rules] = await Promise.all([
    loadPaySettings(supabase, me.business_id),
    supabase.from("staff_compensation").select("plan_id, service_commission_pct").eq("staff_id", me.id).maybeSingle(),
    supabase.rpc("commission_rules", { p_business_id: me.business_id, p_staff_id: me.id }),
  ]);
  if (comp.error) throw comp.error;
  if (rules.error) throw rules.error;
  const periodOf = (date: LocalDate) => periodContaining(settings.kind, settings.anchor, date);
  const period = periodOf(today);
  const week = addDays(today, -((weekdayOf(today) + 6) % 7));
  const versions = planVersions(rules.data);
  const planId = comp.data?.plan_id ?? null;
  const current = planId ? ([...versions].reverse().find((v) => v.planId === planId) ?? null) : null;

  // One load from the earliest of the week, the period and their tier window.
  let from = week < period.from ? week : period.from;
  const windowFrom = current ? windowsFrom({ from: today, to: today }, periodOf) : from;
  if (windowFrom < from) from = windowFrom;
  const [pay] = await loadPayroll(supabase, me.business_id, tz, { from, to: today }, today, me.id);
  const tickets = pay?.tickets ?? [];

  // Checked in, not checked out: an estimate on their booked prices.
  const { data: open, error } = await supabase
    .from("appointment_items")
    .select("id, price_cents, service:services(name), appointment:appointments!inner(status, client:clients(first_name))")
    .eq("staff_id", me.id)
    .eq("location_id", me.location.id)
    .eq("appointment.status", "checked_in")
    .gte("starts_at", startOfLocalDay(today, tz).toISOString())
    .lt("starts_at", startOfLocalDay(addDays(today, 1), tz).toISOString())
    .order("starts_at");
  if (error) throw error;
  const items = open.map((i) => ({ itemId: i.id, service: i.service.name, client: i.appointment.client?.first_name ?? "Walk-in", priceCents: i.price_cents }));
  const rulesFor = (id: string): PlanRules | null => versions.find((v) => v.id === id)?.rules ?? null;
  const windowOf = (at: string, r: PlanRules) => tierWindow(r, dayOf(at), periodOf);
  const nowIso = new Date().toISOString();
  const basis = current ? windowBasis(tickets, rulesFor, windowOf, windowOf(nowIso, current.rules)) : null;
  const guessed = estimates(items, current && basis ? { rules: current.rules, basis, at: nowIso } : { ownPct: Number(comp.data?.service_commission_pct ?? 0) });

  return {
    planName: current?.name ?? null,
    sales: tickets.filter((t) => dayOf(t.at) === today).reverse(),
    estimates: guessed,
    today: totalsBetween(tickets, today, today, dayOf),
    week: totalsBetween(tickets, week, today, dayOf),
    period: { ...totalsBetween(tickets, period.from, today, dayOf), range: { from: period.from, to: today } },
    estimatedCents: guessed.reduce((n, e) => n + e.commissionCents, 0),
    nextTier: current && basis ? nextTierText("service", current.rules, basis.service) : null,
  };
}
