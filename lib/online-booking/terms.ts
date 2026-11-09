// The policy for an online booking, worked out on the server before the
// client agrees: the plain-language text with this visit's amounts,
// whether a card is needed (the salon's rule, or a repeat offender), the
// deposit to pay now (the services' deposits, or the repeat offender's),
// and the card already on file. Service role.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { cardRequired, depositNeeded, hasFees, policyText, standingOf, visitTerms, type VisitTerms } from "@/lib/policy";
import { isNewClient, loadPolicy } from "@/lib/policy-load";
import { loadBookingContext } from "@/lib/scheduling/load";
import { planVisitAt, type PlannedItem, type VisitRequest } from "@/lib/scheduling/online";
import { toLocal } from "@/lib/scheduling/time";
import { depositFor } from "./settings";
import type { BookingSite } from "./site";

type Admin = SupabaseClient<Database>;

export type OnlineTerms = {
  lines: string[];
  terms: VisitTerms;
  cardNeeded: boolean;
  depositCents: number;
  cardOnFile: { ref: string; label: string; provider: string } | null;
  fees: boolean;
  visitCents: number;
};

export async function onlineTerms(admin: Admin, site: BookingSite, clientId: string | null, request: VisitRequest, start: Date, cardHolderId: string | null = null): Promise<OnlineTerms | null> {
  const date = toLocal(start, site.location.timezone).date;
  const ctx = await loadBookingContext(admin, { id: site.location.id, timezone: site.location.timezone }, date, date);
  const items = planVisitAt(ctx, request, start);
  if (!items) return null;
  return termsFor(admin, site, clientId, items, cardHolderId);
}

export async function termsFor(admin: Admin, site: BookingSite, clientId: string | null, items: readonly PlannedItem[], cardHolderId: string | null = null): Promise<OnlineTerms> {
  const priceOf = (i: PlannedItem) => site.stylists.find((s) => s.id === i.staffId)?.prices[i.serviceId] ?? 0;
  const lines = items.map((i) => {
    const s = site.services.find((x) => x.id === i.serviceId);
    return { serviceId: i.serviceId, staffId: i.staffId, priceCents: priceOf(i), depositCents: s ? depositFor(s.depositKind, s.depositAmount, priceOf(i)) : 0 };
  });
  return clientTerms(admin, { id: site.business.id, name: site.business.name }, clientId, lines, cardHolderId);
}

// The same for any visit's lines, each with its price and its service's
// own deposit (a waitlist offer's, which isn't from the booking site).
export async function clientTerms(
  admin: Admin,
  business: { id: string; name: string },
  clientId: string | null,
  lines: readonly { serviceId: string; staffId: string; priceCents: number; depositCents: number }[],
  // A guardian booking for their dependent: whose card it is.
  cardHolderId: string | null = null,
): Promise<OnlineTerms> {
  const policy = await loadPolicy(admin, business.id);
  const visitCents = lines.reduce((sum, l) => sum + l.priceCents, 0);
  const serviceDeposit = lines.reduce((sum, l) => sum + l.depositCents, 0);
  const staffIds = [...new Set(lines.map((l) => l.staffId))];
  const stylists = policy.stylists.filter((p) => staffIds.includes(p.staffId));

  let strikes = 0;
  let cardOnFile: OnlineTerms["cardOnFile"] = null;
  let newClient = true;
  if (clientId) {
    const [{ data: standing, error }, { data: card }, fresh] = await Promise.all([
      admin.rpc("client_policy_standing", { p_client_id: clientId }),
      admin.from("client_cards").select("payment_method_ref, label, provider").eq("client_id", cardHolderId ?? clientId).is("removed_at", null).maybeSingle(),
      isNewClient(admin, clientId),
    ]);
    if (error) throw error;
    strikes = (standing as { strikes: number }).strikes;
    cardOnFile = card ? { ref: card.payment_method_ref, label: card.label, provider: card.provider } : null;
    newClient = fresh;
  }
  const standing = standingOf(policy.settings, strikes);
  const depositCents = depositNeeded(policy.settings, standing, visitCents, serviceDeposit);
  const cardNeeded =
    depositCents > 0 || cardRequired(policy.settings, { serviceIds: lines.map((l) => l.serviceId), staffIds, newClient, repeatOffender: standing.action !== "off" });
  return {
    lines: policyText(policy.settings, { stylists, visitCents, depositCents, extra: policy.extra, salon: business.name }),
    terms: visitTerms(policy.settings, stylists, visitCents, depositCents),
    cardNeeded,
    depositCents,
    cardOnFile,
    fees: hasFees(policy.settings, stylists),
    visitCents,
  };
}
