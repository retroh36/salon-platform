// The policy on a day's visits, for booking details (front of house: the
// tables are theirs to read): whether a card or deposit is still needed,
// the client's late cancellations and no-shows, the visit's terms, and its
// fee once it's a no-show.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types.ts";
import { cardRequired, depositNeeded, standingOf, strikesSince, visitTerms, type FeeStatus, type RepeatAction, type VisitTerms } from "./policy.ts";
import { loadPolicy } from "./policy-load.ts";

type Supabase = SupabaseClient<Database>;

export type VisitPolicy = {
  cardLabel: string | null;
  // Needed by the policy and not on file yet.
  cardNeeded: boolean;
  depositNeededCents: number;
  depositPaidCents: number;
  strikes: number;
  months: number;
  repeatAction: RepeatAction;
  terms: VisitTerms;
  bookedAt: string;
  startsAt: string;
  // A card link sent and not used yet.
  linkOut: boolean;
  fee: {
    id: string;
    kind: "late_cancel" | "no_show";
    feeCents: number;
    fromDepositCents: number;
    status: FeeStatus;
    cardLabel: string | null;
    failureReason: string | null;
    waiveReason: string | null;
  } | null;
  canWaive: boolean;
};

export type PolicyVisit = {
  id: string;
  clientId: string;
  status: string;
  serviceIds: string[];
  staffIds: string[];
  visitCents: number;
  serviceDepositCents: number;
  depositPaidCents: number;
  bookedAt: string;
  startsAt: string;
};

export async function loadVisitPolicies(supabase: Supabase, businessId: string, role: string, visits: readonly PolicyVisit[]): Promise<Map<string, VisitPolicy>> {
  const out = new Map<string, VisitPolicy>();
  if (!visits.length) return out;
  const clientIds = [...new Set(visits.map((v) => v.clientId))];
  const visitIds = visits.map((v) => v.id);
  const [policy, cards, incidents, fees, links, completed] = await Promise.all([
    loadPolicy(supabase, businessId),
    supabase.from("client_cards").select("client_id, label").in("client_id", clientIds).is("removed_at", null),
    supabase.from("policy_fees").select("client_id, kind, status, created_at").in("client_id", clientIds),
    supabase.from("policy_fees").select("id, appointment_id, kind, fee_cents, from_deposit_cents, status, card_label, failure_reason, waive_reason").in("appointment_id", visitIds),
    supabase.from("card_requests").select("client_id, appointment_id").in("client_id", clientIds).eq("status", "open").gt("expires_at", new Date().toISOString()),
    supabase.from("appointments").select("client_id").in("client_id", clientIds).eq("status", "completed"),
  ]);
  for (const r of [cards, incidents, fees, links, completed]) if (r.error) throw r.error;
  const cardOf = new Map(cards.data!.map((c) => [c.client_id, c.label]));
  const returning = new Set(completed.data!.map((a) => a.client_id));
  const feeOf = new Map(fees.data!.map((f) => [f.appointment_id, f]));
  for (const v of visits) {
    const strikes = strikesSince(
      incidents.data!.filter((i) => i.client_id === v.clientId).map((i) => ({ kind: i.kind as "late_cancel" | "no_show", status: i.status, createdAt: new Date(i.created_at) })),
      policy.settings.repeatMonths,
    );
    const standing = standingOf(policy.settings, strikes);
    const stylists = policy.stylists.filter((p) => v.staffIds.includes(p.staffId));
    const open = v.status === "booked" || v.status === "confirmed";
    const depositDue = open ? Math.max(0, depositNeeded(policy.settings, standing, v.visitCents, v.serviceDepositCents) - v.depositPaidCents) : 0;
    const cardLabel = cardOf.get(v.clientId) ?? null;
    const needed = cardRequired(policy.settings, { serviceIds: v.serviceIds, staffIds: v.staffIds, newClient: !returning.has(v.clientId), repeatOffender: standing.action !== "off" });
    const fee = feeOf.get(v.id);
    out.set(v.id, {
      cardLabel,
      cardNeeded: open && needed && !cardLabel,
      depositNeededCents: depositDue,
      depositPaidCents: v.depositPaidCents,
      strikes,
      months: policy.settings.repeatMonths,
      repeatAction: standing.action,
      terms: visitTerms(policy.settings, stylists, v.visitCents, v.depositPaidCents),
      bookedAt: v.bookedAt,
      startsAt: v.startsAt,
      linkOut: links.data!.some((l) => l.client_id === v.clientId && (l.appointment_id === v.id || l.appointment_id === null)),
      fee: fee
        ? {
            id: fee.id,
            kind: fee.kind as "late_cancel" | "no_show",
            feeCents: fee.fee_cents,
            fromDepositCents: fee.from_deposit_cents,
            status: fee.status as FeeStatus,
            cardLabel: fee.card_label,
            failureReason: fee.failure_reason,
            waiveReason: fee.waive_reason,
          }
        : null,
      canWaive: policy.waiveRoles.includes(role),
    });
  }
  return out;
}
