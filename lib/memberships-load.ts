// Loading membership plans and clients' memberships (worked out in
// ./memberships.ts). Staff pages, with the signed-in user's client.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { toLocal, type LocalDate } from "@/lib/scheduling/time";
import type { IntervalUnit, MembershipRow, MembershipStatus } from "./memberships";

type Supabase = SupabaseClient<Database>;

export type MembershipPlan = {
  id: string;
  name: string;
  description: string | null;
  priceCents: number;
  intervalUnit: IntervalUnit;
  intervalCount: number;
  serviceDiscountPct: number;
  retailDiscountPct: number;
  minTermPeriods: number;
  cancelNoticeDays: number;
  allowPause: boolean;
  maxPausePeriods: number;
  isActive: boolean;
  services: { serviceId: string; name: string; quantity: number; rollover: boolean }[];
};

export async function loadPlans(supabase: Supabase, businessId: string, activeOnly = true): Promise<MembershipPlan[]> {
  let query = supabase
    .from("membership_plans")
    .select("*, membership_plan_services(service_id, quantity, rollover, service:services(name))")
    .eq("business_id", businessId)
    .order("name");
  if (activeOnly) query = query.eq("is_active", true);
  const { data, error } = await query;
  if (error) throw error;
  return data.map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    priceCents: p.price_cents,
    intervalUnit: p.interval_unit as IntervalUnit,
    intervalCount: p.interval_count,
    serviceDiscountPct: p.service_discount_pct,
    retailDiscountPct: p.retail_discount_pct,
    minTermPeriods: p.min_term_periods,
    cancelNoticeDays: p.cancel_notice_days,
    allowPause: p.allow_pause,
    maxPausePeriods: p.max_pause_periods,
    isActive: p.is_active,
    services: p.membership_plan_services.map((s) => ({ serviceId: s.service_id, name: s.service.name, quantity: s.quantity, rollover: s.rollover })),
  }));
}

export type MembershipCredit = { id: string; serviceId: string; serviceName: string; allowance: number; used: number };

export type ClientMembership = {
  id: string;
  planId: string | null;
  name: string;
  status: MembershipStatus;
  priceCents: number;
  intervalUnit: IntervalUnit;
  intervalCount: number;
  serviceDiscountPct: number;
  retailDiscountPct: number;
  minTermPeriods: number;
  cancelNoticeDays: number;
  allowPause: boolean;
  maxPausePeriods: number;
  startedOn: LocalDate;
  anchorOn: LocalDate;
  periodsPaid: number;
  currentPeriodStart: LocalDate;
  currentPeriodEnd: LocalDate;
  cardLabel: string | null;
  provider: string;
  failedAttempts: number;
  // The day a failed payment is tried again, at the salon.
  nextRetryOn: LocalDate | null;
  pauseFrom: LocalDate | null;
  resumeOn: LocalDate | null;
  cancelsOn: LocalDate | null;
  cancelReason: string | null;
  // What's included this period.
  credits: MembershipCredit[];
};

const SELECT =
  "id, client_id, plan_id, name, status, price_cents, interval_unit, interval_count, service_discount_pct, retail_discount_pct, min_term_periods, cancel_notice_days, allow_pause, max_pause_periods, started_on, anchor_on, periods_paid, current_period_start, current_period_end, card_label, provider, failed_attempts, next_retry_at, pause_from, resume_on, cancels_on, cancel_reason, location:locations(timezone), membership_credits(id, service_id, period_start, allowance, used, service:services(name))";

type Row = Database["public"]["Tables"]["client_memberships"]["Row"] & {
  membership_credits: { id: string; service_id: string; period_start: string; allowance: number; used: number; service: { name: string } }[];
  location: { timezone: string };
};

function toMembership(r: Row): ClientMembership {
  return {
    id: r.id,
    planId: r.plan_id,
    name: r.name,
    status: r.status,
    priceCents: r.price_cents,
    intervalUnit: r.interval_unit as IntervalUnit,
    intervalCount: r.interval_count,
    serviceDiscountPct: r.service_discount_pct,
    retailDiscountPct: r.retail_discount_pct,
    minTermPeriods: r.min_term_periods,
    cancelNoticeDays: r.cancel_notice_days,
    allowPause: r.allow_pause,
    maxPausePeriods: r.max_pause_periods,
    startedOn: r.started_on,
    anchorOn: r.anchor_on,
    periodsPaid: r.periods_paid,
    currentPeriodStart: r.current_period_start,
    currentPeriodEnd: r.current_period_end,
    cardLabel: r.card_label,
    provider: r.provider,
    failedAttempts: r.failed_attempts,
    nextRetryOn: r.next_retry_at ? toLocal(new Date(r.next_retry_at), r.location.timezone).date : null,
    pauseFrom: r.pause_from,
    resumeOn: r.resume_on,
    cancelsOn: r.cancels_on,
    cancelReason: r.cancel_reason,
    credits: r.membership_credits
      .filter((c) => c.period_start === r.current_period_start)
      .map((c) => ({ id: c.id, serviceId: c.service_id, serviceName: c.service.name, allowance: c.allowance, used: c.used }))
      .sort((a, b) => a.serviceName.localeCompare(b.serviceName)),
  };
}

// A client's memberships, live ones first (ended ones too, for the
// profile, unless liveOnly).
export async function loadClientMemberships(supabase: Supabase, clientId: string, liveOnly = false): Promise<ClientMembership[]> {
  let query = supabase.from("client_memberships").select(SELECT).eq("client_id", clientId).order("created_at", { ascending: false });
  if (liveOnly) query = query.neq("status", "canceled");
  const { data, error } = await query;
  if (error) throw error;
  const order: MembershipStatus[] = ["past_due", "active", "paused", "canceled"];
  return (data as unknown as Row[]).map(toMembership).sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status));
}

// Live memberships for many clients (the calendar's visits).
export async function loadMembershipsByClient(supabase: Supabase, clientIds: readonly string[]): Promise<Map<string, ClientMembership[]>> {
  const out = new Map<string, ClientMembership[]>();
  for (let i = 0; i < clientIds.length; i += 200) {
    const { data, error } = await supabase.from("client_memberships").select(SELECT).in("client_id", clientIds.slice(i, i + 200)).neq("status", "canceled");
    if (error) throw error;
    for (const r of data as unknown as Row[]) out.set(r.client_id, [...(out.get(r.client_id) ?? []), toMembership(r)]);
  }
  return out;
}

// A credit for this service with a use left, on an active membership.
export function creditFor(memberships: readonly ClientMembership[], serviceId: string, alreadyUsed: ReadonlyMap<string, number> = new Map()): { membership: ClientMembership; credit: MembershipCredit } | null {
  for (const membership of memberships) {
    if (membership.status !== "active") continue;
    const credit = membership.credits.find((c) => c.serviceId === serviceId && c.used + (alreadyUsed.get(c.id) ?? 0) < c.allowance);
    if (credit) return { membership, credit };
  }
  return null;
}

// Every membership, for the owners' report.
export async function loadMembershipRows(supabase: Supabase, businessId: string, timeZone: string): Promise<MembershipRow[]> {
  const { data, error } = await supabase
    .from("client_memberships")
    .select("status, plan_id, name, price_cents, interval_unit, interval_count, started_on, canceled_at, cancel_reason")
    .eq("business_id", businessId);
  if (error) throw error;
  return data.map((r) => ({
    status: r.status,
    planId: r.plan_id,
    name: r.name,
    priceCents: r.price_cents,
    intervalUnit: r.interval_unit as IntervalUnit,
    intervalCount: r.interval_count,
    startedOn: r.started_on,
    endedOn: r.canceled_at ? toLocal(new Date(r.canceled_at), timeZone).date : null,
    voided: (r.cancel_reason ?? "").startsWith("Void:"),
  }));
}
