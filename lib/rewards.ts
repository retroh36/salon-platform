// The salon's rewards program (pure, unit-tested). The database earns and
// takes back points the same way (private.sale_points, private.reward_tier),
// and these mirror it for the checkout screen, the client's account and
// the reports.
//
// Points are earned on what the client paid for services and retail
// (after every discount, before tax; never tips, tax or gift cards; package
// and membership sales and the services they pay for only if the salon
// chooses), at the salon's rate per dollar, plus their tier's bonus.
// Rewards from the catalog come off at checkout like a promotion: after
// member prices and promotions, before staff discounts.

import type { PromoRule } from "./promotions.ts";

export type TierBasis = "spend" | "visits";

export type Program = {
  enabled: boolean;
  // Whole points per dollar.
  servicePoints: number;
  retailPoints: number;
  earnOnPackages: boolean;
  earnOnMemberships: boolean;
  birthdayPoints: number;
  referralPoints: number;
  rebookPoints: number;
  firstVisitPoints: number;
  // Points not used for this many months after the client's last earning
  // expire (null: never).
  expiryMonths: number | null;
  // The balance a client needs before any reward can be taken.
  minRedeemPoints: number;
  // Rewards can be used with promotions on the same sale.
  stackWithPromotions: boolean;
  tierBasis: TierBasis;
};

export type Tier = {
  id: string;
  name: string;
  // Cents spent, or visits, in the last 12 months.
  threshold: number;
  // Extra points on what they earn, as a percent (25: 25% more).
  bonusPct: number;
  // A service they get free once a visit (null: none).
  freeAddonServiceId: string | null;
  priorityBooking: boolean;
};

export type RewardKind = "amount" | "percent" | "free_service";

export type Reward = {
  id: string;
  name: string;
  points: number;
  kind: RewardKind;
  amountCents: number | null;
  pct: number | null;
  services: boolean;
  retail: boolean;
  // Only these services (null: any).
  serviceIds: string[] | null;
  // How many times a client can take it in 12 months (null: no limit).
  maxPerYear: number | null;
  // Only from this tier up (null: anyone).
  minTierId: string | null;
};

export type PointsKind = "earn" | "bonus" | "redeem" | "adjust" | "expire" | "reverse" | "restore";

export const KIND_LABEL: Record<PointsKind, string> = {
  earn: "Earned",
  bonus: "Bonus",
  redeem: "Redeemed",
  adjust: "Adjusted",
  expire: "Expired",
  reverse: "Taken back",
  restore: "Given back",
};

export const BONUS_LABEL: Record<string, string> = {
  birthday: "Birthday bonus",
  referral: "Referral bonus",
  rebook: "Booked their next visit",
  first_visit: "First visit",
};

// A sale line as earning sees it: what was paid for it after every
// discount, before tax.
export type EarnLine = { kind: "service" | "product" | "package" | "membership" | "gift_card" | "gift_card_reload"; netCents: number; coveredBy: "package" | "membership" | null };

// Points for a sale: services and retail at their own rates per whole
// dollar of each (rounded down), then the tier's bonus (rounded down).
export function pointsFor(lines: readonly EarnLine[], program: Program, bonusPct = 0): number {
  if (!program.enabled) return 0;
  let services = 0;
  let retail = 0;
  for (const l of lines) {
    if (l.netCents <= 0) continue;
    if (l.kind === "product") retail += l.netCents;
    else if (l.kind === "service") {
      if (l.coveredBy === "package" && !program.earnOnPackages) continue;
      if (l.coveredBy === "membership" && !program.earnOnMemberships) continue;
      services += l.netCents;
    } else if (l.kind === "package" && program.earnOnPackages) services += l.netCents;
    else if (l.kind === "membership" && program.earnOnMemberships) services += l.netCents;
  }
  const base = Math.floor((services * program.servicePoints) / 100) + Math.floor((retail * program.retailPoints) / 100);
  return base + Math.floor((base * bonusPct) / 100);
}

// Points taken back when part of a sale is refunded: the same share of
// what it earned as the share of its money given back (rounded up, so a
// full refund takes everything back).
export function pointsBack(earned: number, refundedCents: number, paidCents: number): number {
  if (earned <= 0 || refundedCents <= 0 || paidCents <= 0) return 0;
  return Math.min(earned, Math.ceil((earned * refundedCents) / paidCents));
}

// The tier a client is in: the highest whose threshold they've reached.
export function tierFor<T extends Pick<Tier, "threshold">>(tiers: readonly T[], spendCents: number, visits: number, basis: TierBasis): T | null {
  const amount = basis === "spend" ? spendCents : visits;
  let best: T | null = null;
  for (const t of tiers) if (amount >= t.threshold && (!best || t.threshold > best.threshold)) best = t;
  return best;
}

// The next tier up and how far there is to go.
export function nextTier<T extends Pick<Tier, "threshold" | "name">>(tiers: readonly T[], spendCents: number, visits: number, basis: TierBasis): { tier: T; toGo: number } | null {
  const amount = basis === "spend" ? spendCents : visits;
  const up = tiers.filter((t) => t.threshold > amount).sort((a, b) => a.threshold - b.threshold)[0];
  return up ? { tier: up, toGo: up.threshold - amount } : null;
}

export type ClientRewards = {
  balance: number;
  tierId: string | null;
  // Times each reward was taken in the last 12 months.
  usedThisYear: Record<string, number>;
};

// Why a client can't take a reward now (null: they can).
export function rewardProblem(reward: Reward, client: ClientRewards, program: Program, tiers: readonly Tier[]): string | null {
  if (!program.enabled) return "The rewards program is off.";
  if (client.balance < program.minRedeemPoints) return `Rewards start at ${program.minRedeemPoints.toLocaleString("en-US")} points.`;
  if (client.balance < reward.points) return `${(reward.points - client.balance).toLocaleString("en-US")} more points needed.`;
  if (reward.maxPerYear !== null && (client.usedThisYear[reward.id] ?? 0) >= reward.maxPerYear) return `Already used ${reward.maxPerYear === 1 ? "this year" : `${reward.maxPerYear} times this year`}.`;
  if (reward.minTierId) {
    const need = tiers.find((t) => t.id === reward.minTierId);
    const mine = tiers.find((t) => t.id === client.tierId);
    if (need && (!mine || mine.threshold < need.threshold)) return `For ${need.name} and up.`;
  }
  return null;
}

// Several rewards on one sale: each must be affordable together.
export function rewardsProblem(rewards: readonly Reward[], client: ClientRewards, program: Program, tiers: readonly Tier[]): string | null {
  let balance = client.balance;
  // The minimum is for the balance they start with.
  for (const [i, r] of rewards.entries()) {
    const problem = rewardProblem(r, { ...client, balance }, i ? { ...program, minRedeemPoints: 0 } : program, tiers);
    if (problem) return `${r.name}: ${problem}`;
    balance -= r.points;
  }
  return null;
}

// A reward as a promotion, so the checkout prices it exactly as
// promotions are (lib/promotions.ts applyPromotions): an amount off once,
// a percent off what it covers, or a free service (the first line for that
// service, in full).
export function rewardRule(r: Reward): PromoRule {
  return {
    id: r.id,
    name: r.name,
    kind: "code",
    code: null,
    discount: r.kind === "amount" ? { kind: "amount", cents: r.amountCents ?? 0 } : r.kind === "percent" ? { kind: "percent", pct: r.pct ?? 0 } : { kind: "line" },
    services: r.kind === "free_service" ? true : r.services,
    retail: r.kind === "free_service" ? false : r.retail,
    serviceIds: r.serviceIds,
    categories: null,
    staffIds: null,
    levels: null,
    exclusions: [],
    productIds: null,
    startsOn: null,
    endsOn: null,
    maxUses: null,
    maxPerClient: null,
    newClientsOnly: false,
    firstVisitOnly: false,
    minSpendCents: null,
    stackable: true,
    online: false,
    hoursAhead: null,
  };
}

// The tier's free add-on as a promotion: the first line for that service,
// in full (complete_sale's tier_perk).
export function perkRule(tier: Tier): PromoRule | null {
  if (!tier.freeAddonServiceId) return null;
  return {
    ...rewardRule({ id: tier.id, name: `${tier.name} free add-on`, points: 0, kind: "free_service", amountCents: null, pct: null, services: true, retail: false, serviceIds: [tier.freeAddonServiceId], maxPerYear: null, minTierId: null }),
  };
}

// The reward a client is closest to and can't take yet, for Denise's line
// at checkout ("Linda is 40 points from a free gloss.").
export function closestReward(rewards: readonly Reward[], balance: number): { reward: Reward; toGo: number } | null {
  const ahead = rewards.filter((r) => r.points > balance).sort((a, b) => a.points - b.points)[0];
  return ahead ? { reward: ahead, toGo: ahead.points - balance } : null;
}

// Denise's line about a client's points at checkout ("Linda is 40 points
// from a free gloss."), with what they can take already. Our wording.
export const CLOSE_POINTS = 100;
export function pointsLine(firstName: string, balance: number, rewards: readonly Reward[], available: readonly Reward[]): string | null {
  const close = closestReward(rewards, balance);
  const near = close && close.toGo <= CLOSE_POINTS ? close : null;
  if (available.length) {
    const best = [...available].sort((a, b) => b.points - a.points)[0];
    const now = `${firstName} has ${points(balance)}: enough for ${lower(best.name)}`;
    return near ? `${now}, and ${points(near.toGo)} from ${lower(near.reward.name)}.` : `${now}.`;
  }
  if (!close) return null;
  return `${firstName} is ${points(close.toGo)} from ${lower(close.reward.name)}.`;
}

export const points = (n: number) => `${n.toLocaleString("en-US")} ${Math.abs(n) === 1 ? "point" : "points"}`;

// "Free gloss" reads "a free gloss" in a sentence; "$25 off" stays.
function lower(name: string): string {
  const first = name.charAt(0).toLowerCase() + name.slice(1);
  return /^free\b/i.test(name) ? `a ${first}` : first;
}

// What a point is worth, for estimated values in reports: the best
// amount-off reward's dollars per point (0 without one).
export function centsPerPoint(rewards: readonly Pick<Reward, "kind" | "amountCents" | "points">[]): number {
  let best = 0;
  for (const r of rewards) if (r.kind === "amount" && r.amountCents && r.points > 0) best = Math.max(best, r.amountCents / r.points);
  return best;
}

// The reward's value in words for the catalog ("$25 off", "20% off retail",
// "Free Gloss / Toner").
export function rewardValue(r: Reward, serviceName: (id: string) => string | undefined): string {
  if (r.kind === "free_service") return `Free ${r.serviceIds?.length === 1 ? (serviceName(r.serviceIds[0]) ?? "service") : "service"}`;
  const what = r.services && r.retail ? "" : r.services ? " services" : " retail";
  if (r.kind === "percent") return `${r.pct}% off${what}`;
  return `$${((r.amountCents ?? 0) / 100).toFixed((r.amountCents ?? 0) % 100 ? 2 : 0)} off${what}`;
}

// The stored rows to ours.
export type ProgramRow = {
  enabled: boolean;
  service_points_per_dollar: number;
  retail_points_per_dollar: number;
  earn_on_packages: boolean;
  earn_on_memberships: boolean;
  birthday_points: number;
  referral_points: number;
  rebook_points: number;
  first_visit_points: number;
  expiry_months: number | null;
  min_redeem_points: number;
  stack_with_promotions: boolean;
  tier_basis: string;
};

export const PROGRAM_COLUMNS =
  "enabled, service_points_per_dollar, retail_points_per_dollar, earn_on_packages, earn_on_memberships, birthday_points, referral_points, rebook_points, first_visit_points, expiry_months, min_redeem_points, stack_with_promotions, tier_basis";

export const NO_PROGRAM: Program = {
  enabled: false,
  servicePoints: 1,
  retailPoints: 1,
  earnOnPackages: false,
  earnOnMemberships: false,
  birthdayPoints: 0,
  referralPoints: 0,
  rebookPoints: 0,
  firstVisitPoints: 0,
  expiryMonths: null,
  minRedeemPoints: 0,
  stackWithPromotions: false,
  tierBasis: "spend",
};

export function programOf(r: ProgramRow | null): Program {
  if (!r) return NO_PROGRAM;
  return {
    enabled: r.enabled,
    servicePoints: r.service_points_per_dollar,
    retailPoints: r.retail_points_per_dollar,
    earnOnPackages: r.earn_on_packages,
    earnOnMemberships: r.earn_on_memberships,
    birthdayPoints: r.birthday_points,
    referralPoints: r.referral_points,
    rebookPoints: r.rebook_points,
    firstVisitPoints: r.first_visit_points,
    expiryMonths: r.expiry_months,
    minRedeemPoints: r.min_redeem_points,
    stackWithPromotions: r.stack_with_promotions,
    tierBasis: r.tier_basis === "visits" ? "visits" : "spend",
  };
}

export type TierRow = { id: string; name: string; threshold: number; bonus_pct: number; free_addon_service_id: string | null; priority_booking: boolean };
export const TIER_COLUMNS = "id, name, threshold, bonus_pct, free_addon_service_id, priority_booking";
export const tierOf = (r: TierRow): Tier => ({ id: r.id, name: r.name, threshold: r.threshold, bonusPct: r.bonus_pct, freeAddonServiceId: r.free_addon_service_id, priorityBooking: r.priority_booking });

export type RewardRow = {
  id: string;
  name: string;
  points: number;
  kind: string;
  amount_cents: number | null;
  percent: number | null;
  applies_services: boolean;
  applies_retail: boolean;
  service_ids: string[] | null;
  max_per_year: number | null;
  min_tier_id: string | null;
};
export const REWARD_COLUMNS = "id, name, points, kind, amount_cents, percent, applies_services, applies_retail, service_ids, max_per_year, min_tier_id";
export const rewardOf = (r: RewardRow): Reward => ({
  id: r.id,
  name: r.name,
  points: r.points,
  kind: (["amount", "percent", "free_service"].includes(r.kind) ? r.kind : "amount") as RewardKind,
  amountCents: r.amount_cents,
  pct: r.percent,
  services: r.applies_services,
  retail: r.applies_retail,
  serviceIds: r.service_ids,
  maxPerYear: r.max_per_year,
  minTierId: r.min_tier_id,
});

// The program at a glance, for Reports and Denise (pure, from
// rewards_report and reward_members).
export type ReportJson = {
  earned: number;
  bonus: number;
  redeemed: number;
  redemptions: number;
  discount_cents: number;
  expired: number;
  adjusted: number;
  outstanding: number;
  members: number;
  referrals: { referred: number; completed: number; points: number };
};

export type Member = { clientId: string; firstName: string; balance: number; tierId: string | null; spendCents: number; visits: number };

export type RewardsOverview = {
  earned: number;
  bonus: number;
  redeemed: number;
  redemptions: number;
  discountCents: number;
  expired: number;
  outstanding: number;
  // What the points out there would come to at the best amount-off reward.
  outstandingCents: number;
  // Of the points earned in the period, the share redeemed (null: none earned).
  redemptionRate: number | null;
  members: number;
  byTier: { tierId: string | null; name: string; count: number }[];
  referrals: { referred: number; completed: number; points: number };
  // The top tier's clients (or the biggest spenders without tiers), most spent first.
  vips: Member[];
};

export function rewardsOverview(report: ReportJson, members: readonly Member[], tiers: readonly Tier[], catalog: readonly Reward[]): RewardsOverview {
  const perPoint = centsPerPoint(catalog);
  const counts = new Map<string | null, number>();
  for (const m of members) counts.set(m.tierId, (counts.get(m.tierId) ?? 0) + 1);
  const ordered = [...tiers].sort((a, b) => b.threshold - a.threshold);
  const top = ordered[0];
  const bySpend = [...members].sort((a, b) => b.spendCents - a.spendCents);
  return {
    earned: report.earned,
    bonus: report.bonus,
    redeemed: report.redeemed,
    redemptions: report.redemptions,
    discountCents: report.discount_cents,
    expired: report.expired,
    outstanding: report.outstanding,
    outstandingCents: Math.round(report.outstanding * perPoint),
    redemptionRate: report.earned > 0 ? Math.round((report.redeemed / report.earned) * 1000) / 10 : null,
    members: members.length,
    byTier: [...ordered.map((t) => ({ tierId: t.id as string | null, name: t.name, count: counts.get(t.id) ?? 0 })), ...(tiers.length ? [{ tierId: null, name: "No tier yet", count: counts.get(null) ?? 0 }] : [])],
    referrals: report.referrals,
    vips: top ? bySpend.filter((m) => m.tierId === top.id) : bySpend.slice(0, 10),
  };
}
