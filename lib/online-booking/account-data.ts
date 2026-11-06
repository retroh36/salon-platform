// What a signed-in client sees in their account (./account.ts): their own
// visits, balances, card and message preferences at this salon, and nothing
// internal (no notes, no other clients, no staff details beyond a first
// name and the portrait the booking site shows). Every query is filtered by
// the account's client and salon.

import type { SupabaseClient } from "@supabase/supabase-js";
import { staffPhotoUrl } from "@/lib/branding";
import type { Database } from "@/lib/database.types";
import { nextTier, rewardProblem } from "@/lib/rewards";
import { heldOffer } from "./promotions";
import { entryLabel, loadRewardSettings, summaryOf } from "@/lib/rewards-load";
import type { Account } from "./account";

type Admin = SupabaseClient<Database>;

export type AccountVisit = {
  id: string;
  status: string;
  start: string;
  end: string;
  items: { serviceId: string; service: string; staffId: string; stylist: string; photoUrl: string | null; priceCents: number }[];
  // Coming up: what it costs after the offer it was booked with, if any.
  totalCents: number;
  offer: { label: string; discountCents: number } | null;
};

export type MessagePrefs = { sms: boolean; email: boolean; visitSms: boolean; visitEmail: boolean; stopped: boolean };

export type AccountData = {
  firstName: string;
  contact: { email: string | null; phone: string | null };
  upcoming: AccountVisit[];
  past: AccountVisit[];
  giftCards: { last4: string; balanceCents: number; expiresAt: string | null }[];
  packages: { name: string; expiresAt: string | null; left: { service: string; uses: number }[] }[];
  card: { label: string; since: string } | null;
  // Offers (sms, email) and messages about their visits, and whether they replied STOP.
  messages: MessagePrefs;
  // The last finished visit's services and stylist, to book again.
  // With the stylist's name and portrait when there was one stylist.
  rebook: { serviceIds: string[]; staffId: string | null; label: string; stylist: { name: string; photoUrl: string | null } | null } | null;
  // Their rewards (null when the salon has no program on).
  rewards: AccountRewards | null;
};

export type AccountRewards = {
  balance: number;
  tier: string | null;
  next: string | null;
  rewards: { name: string; points: number; ready: boolean }[];
  history: { at: string; label: string; delta: number }[];
  referralCode: string | null;
  referralPoints: number;
};

const PAST_SHOWN = 10;

export async function loadAccount(admin: Admin, account: Account, now = new Date()): Promise<AccountData> {
  const { clientId, businessId } = account;
  const visitColumns = "id, status, starts_at, ends_at, promotion_id, appointment_items(service_id, staff_id, starts_at, price_cents, service:services(name), staff:staff(first_name, photo_path))";
  const [client, upcoming, past, cards, packages, card, rewards] = await Promise.all([
    admin.from("clients").select("first_name, email, phone, sms_opt_in, email_opt_in, appointment_sms_ok, appointment_email_ok, sms_stopped_at").eq("id", clientId).eq("business_id", businessId).single(),
    admin
      .from("appointments")
      .select(visitColumns)
      .eq("client_id", clientId)
      .eq("business_id", businessId)
      .in("status", ["booked", "confirmed", "checked_in"])
      .gte("ends_at", now.toISOString())
      .order("starts_at"),
    admin
      .from("appointments")
      .select(visitColumns)
      .eq("client_id", clientId)
      .eq("business_id", businessId)
      .eq("status", "completed")
      .order("starts_at", { ascending: false })
      .limit(PAST_SHOWN),
    admin.from("gift_cards").select("code, balance_cents, expires_at").eq("owner_client_id", clientId).eq("business_id", businessId).eq("status", "active").gt("balance_cents", 0),
    admin
      .from("client_packages")
      .select("name, expires_at, client_package_items(total, used, service:services(name))")
      .eq("client_id", clientId)
      .eq("business_id", businessId)
      .eq("status", "active"),
    admin.from("client_cards").select("label, created_at").eq("client_id", clientId).eq("business_id", businessId).is("removed_at", null).maybeSingle(),
    loadAccountRewards(admin, account),
  ]);
  for (const r of [client, upcoming, past, cards, packages, card]) if (r.error) throw r.error;

  const visit = (a: NonNullable<typeof upcoming.data>[number]): AccountVisit => {
    const items = [...a.appointment_items]
      .sort((x, y) => x.starts_at.localeCompare(y.starts_at))
      .map((i) => ({ serviceId: i.service_id, service: i.service.name, staffId: i.staff_id, stylist: i.staff.first_name, photoUrl: staffPhotoUrl(i.staff.photo_path), priceCents: i.price_cents }));
    return { id: a.id, status: a.status, start: a.starts_at, end: a.ends_at, items, totalCents: items.reduce((n, i) => n + i.priceCents, 0), offer: null };
  };
  const pastVisits = past.data!.map(visit);
  const upcomingVisits = await Promise.all(
    upcoming.data!.map(async (a) => {
      const v = visit(a);
      const offer = await heldOffer(admin, businessId, a.promotion_id, v.items);
      return { ...v, offer, totalCents: v.totalCents - (offer?.discountCents ?? 0) };
    }),
  );
  const last = pastVisits[0];
  const stylists = last ? [...new Set(last.items.map((i) => i.staffId))] : [];
  const c = client.data!;

  return {
    firstName: c.first_name,
    contact: { email: c.email, phone: c.phone },
    upcoming: upcomingVisits,
    past: pastVisits,
    giftCards: cards.data!.map((g) => ({ last4: g.code.slice(-4), balanceCents: g.balance_cents, expiresAt: g.expires_at })).filter((g) => !g.expiresAt || new Date(g.expiresAt) > now),
    packages: packages
      .data!.filter((p) => !p.expires_at || new Date(p.expires_at) > now)
      .map((p) => ({ name: p.name, expiresAt: p.expires_at, left: p.client_package_items.filter((i) => i.used < i.total).map((i) => ({ service: i.service.name, uses: i.total - i.used })) }))
      .filter((p) => p.left.length > 0),
    card: card.data ? { label: card.data.label, since: card.data.created_at } : null,
    messages: { sms: c.sms_opt_in, email: c.email_opt_in, visitSms: c.appointment_sms_ok, visitEmail: c.appointment_email_ok, stopped: Boolean(c.sms_stopped_at) },
    rebook: last
      ? { serviceIds: last.items.map((i) => i.serviceId), staffId: stylists.length === 1 ? stylists[0] : null, label: rebookLabel(last), stylist: stylists.length === 1 ? { name: last.items[0].stylist, photoUrl: last.items[0].photoUrl } : null }
      : null,
    rewards,
  };
}

// Their points, tier, what they can take and their latest changes, worded
// for the client (account_rewards, service role, for this account's client).
export async function loadAccountRewards(admin: Admin, account: Account): Promise<AccountRewards | null> {
  const settings = await loadRewardSettings(admin, account.businessId);
  if (!settings.program.enabled) return null;
  const [summary, history] = await Promise.all([
    admin.rpc("account_rewards", { p_client_id: account.clientId }),
    admin.from("reward_points").select("created_at, delta, kind, bonus, reward:rewards(name)").eq("client_id", account.clientId).eq("business_id", account.businessId).order("created_at", { ascending: false }).limit(10),
  ]);
  if (summary.error) throw summary.error;
  if (history.error) throw history.error;
  const s = summaryOf(summary.data as never);
  const next = nextTier(settings.tiers, s.spendCents, s.visits, settings.program.tierBasis);
  return {
    balance: s.balance,
    tier: settings.tiers.find((t) => t.id === s.tierId)?.name ?? null,
    next: next ? `${settings.program.tierBasis === "spend" ? `$${Math.ceil(next.toGo / 100).toLocaleString("en-US")} more` : `${next.toGo} more ${next.toGo === 1 ? "visit" : "visits"}`} this year to reach ${next.tier.name}` : null,
    rewards: settings.catalog.map((r) => ({ name: r.name, points: r.points, ready: !rewardProblem(r, s, settings.program, settings.tiers) })),
    history: history.data.map((h) => ({ at: h.created_at, label: entryLabel(h.kind as never, h.bonus, h.reward?.name ?? null), delta: h.delta })),
    referralCode: s.referralCode,
    referralPoints: settings.program.referralPoints,
  };
}


// Just their last finished visit, to offer "Book again" at the top of the
// booking site (only services still on the menu online, worked out there).
export async function loadRebook(admin: Admin, account: Account): Promise<AccountData["rebook"]> {
  const { data, error } = await admin
    .from("appointments")
    .select("appointment_items(service_id, staff_id, starts_at, service:services(name), staff:staff(first_name, photo_path))")
    .eq("client_id", account.clientId)
    .eq("business_id", account.businessId)
    .eq("status", "completed")
    .order("starts_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data?.appointment_items.length) return null;
  const items = [...data.appointment_items]
    .sort((x, y) => x.starts_at.localeCompare(y.starts_at))
    .map((i) => ({ serviceId: i.service_id, service: i.service.name, staffId: i.staff_id, stylist: i.staff.first_name, photoUrl: staffPhotoUrl(i.staff.photo_path), priceCents: 0 }));
  const stylists = [...new Set(items.map((i) => i.staffId))];
  return {
    serviceIds: items.map((i) => i.serviceId),
    staffId: stylists.length === 1 ? stylists[0] : null,
    label: rebookLabel({ items }),
    stylist: stylists.length === 1 ? { name: items[0].stylist, photoUrl: items[0].photoUrl } : null,
  };
}

// "Women's Cut & Style with Bridget"
export function rebookLabel(visit: Pick<AccountVisit, "items">): string {
  const services = visit.items.map((i) => i.service);
  const stylists = [...new Set(visit.items.map((i) => i.stylist))];
  const what = services.length <= 2 ? services.join(" and ") : `${services.slice(0, -1).join(", ")} and ${services.at(-1)}`;
  return stylists.length === 1 ? `${what} with ${stylists[0]}` : what;
}

// Whether this visit is the account's own (before changing or canceling it).
export async function ownsVisit(admin: Admin, account: Account, appointmentId: string): Promise<boolean> {
  const { data, error } = await admin.from("appointments").select("id").eq("id", appointmentId).eq("client_id", account.clientId).eq("business_id", account.businessId).maybeSingle();
  if (error) throw error;
  return Boolean(data);
}
