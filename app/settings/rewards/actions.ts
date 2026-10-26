"use server";

import { revalidatePath } from "next/cache";
import { getCurrentStaff } from "@/lib/auth";
import { parseDollars } from "@/lib/checkout";
import { isUuid } from "@/lib/ids";
import { can } from "@/lib/permissions";

export type Result = { ok: true; message: string } | { ok: false; message: string };

const whole = (v: string, min: number, max: number) => {
  const n = Number(v.trim() || "0");
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
};

const failed = (error: { code?: string; message: string }): Result => ({ ok: false, message: ["22023", "42501", "P0002", "23505"].includes(error.code ?? "") ? error.message : "That didn't save. Try again." });

export type ProgramInput = {
  enabled: boolean;
  servicePoints: string;
  retailPoints: string;
  earnOnPackages: boolean;
  earnOnMemberships: boolean;
  birthdayPoints: string;
  referralPoints: string;
  rebookPoints: string;
  firstVisitPoints: string;
  expiryMonths: string;
  minRedeemPoints: string;
  stackWithPromotions: boolean;
  tierBasis: "spend" | "visits";
};

export async function saveProgram(input: ProgramInput): Promise<Result> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!can(me, "settings")) return { ok: false, message: "Only owners and managers change the rewards program." };
  const service = whole(input.servicePoints, 0, 100);
  const retail = whole(input.retailPoints, 0, 100);
  if (service === null || retail === null) return { ok: false, message: "Points per dollar are whole numbers from 0 to 100." };
  const bonuses = [input.birthdayPoints, input.referralPoints, input.rebookPoints, input.firstVisitPoints].map((v) => whole(v, 0, 100_000));
  if (bonuses.some((b) => b === null)) return { ok: false, message: "Bonuses are whole numbers of points (0 for none)." };
  const expiry = input.expiryMonths.trim() ? whole(input.expiryMonths, 1, 120) : null;
  if (input.expiryMonths.trim() && expiry === null) return { ok: false, message: "Points expire after 1 to 120 months, or leave it empty for never." };
  const min = whole(input.minRedeemPoints, 0, 1_000_000);
  if (min === null) return { ok: false, message: "The minimum is a whole number of points." };
  const [birthday, referral, rebook, firstVisit] = bonuses as number[];
  const { error } = await supabase.rpc("save_reward_program", {
    p_business_id: me.business_id,
    p_program: {
      enabled: input.enabled,
      service_points_per_dollar: service,
      retail_points_per_dollar: retail,
      earn_on_packages: input.earnOnPackages,
      earn_on_memberships: input.earnOnMemberships,
      birthday_points: birthday,
      referral_points: referral,
      rebook_points: rebook,
      first_visit_points: firstVisit,
      expiry_months: expiry,
      min_redeem_points: min,
      stack_with_promotions: input.stackWithPromotions,
      tier_basis: input.tierBasis === "visits" ? "visits" : "spend",
    },
  });
  if (error) return failed(error);
  revalidatePath("/settings/rewards");
  return { ok: true, message: input.enabled ? "Saved. Clients earn points from their next sale." : "Saved. The program is off." };
}

export type TierInput = { id: string | null; name: string; threshold: string; bonusPct: string; freeAddonServiceId: string; priorityBooking: boolean };

// threshold is dollars (spend) or visits, as the program counts.
export async function saveTiers(tiers: TierInput[], basis: "spend" | "visits"): Promise<Result> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!can(me, "settings")) return { ok: false, message: "Only owners and managers change the rewards program." };
  if (tiers.length > 6) return { ok: false, message: "Up to 6 tiers." };
  const rows = [];
  for (const t of tiers) {
    const name = t.name.trim();
    if (!name || name.length > 40) return { ok: false, message: "Give each tier a name." };
    const threshold = basis === "spend" ? parseDollars(t.threshold || "0") : whole(t.threshold, 0, 1000);
    if (threshold === null || threshold < 0) return { ok: false, message: `Enter what ${name} needs (${basis === "spend" ? "dollars spent" : "visits"} in 12 months).` };
    const bonus = whole(t.bonusPct, 0, 500);
    if (bonus === null) return { ok: false, message: `${name}'s bonus is a whole percent.` };
    if (t.freeAddonServiceId && !isUuid(t.freeAddonServiceId)) return { ok: false, message: "Choose a service." };
    rows.push({ id: t.id && isUuid(t.id) ? t.id : null, name, threshold, bonus_pct: bonus, free_addon_service_id: t.freeAddonServiceId || null, priority_booking: t.priorityBooking });
  }
  if (new Set(rows.map((r) => r.threshold)).size < rows.length) return { ok: false, message: "Each tier needs a different threshold." };
  const { error } = await supabase.rpc("save_reward_tiers", { p_business_id: me.business_id, p_tiers: rows });
  if (error) return failed(error);
  revalidatePath("/settings/rewards");
  return { ok: true, message: "Tiers saved." };
}

export type RewardInput = {
  id: string | null;
  name: string;
  points: string;
  kind: "amount" | "percent" | "free_service";
  amount: string;
  percent: string;
  appliesTo: "both" | "services" | "retail";
  serviceId: string;
  maxPerYear: string;
  minTierId: string;
  isActive: boolean;
};

export async function saveReward(input: RewardInput): Promise<Result> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!can(me, "settings")) return { ok: false, message: "Only owners and managers change the rewards program." };
  const name = input.name.trim();
  if (!name || name.length > 60) return { ok: false, message: "Give the reward a name." };
  const points = whole(input.points, 1, 1_000_000);
  if (!points) return { ok: false, message: "Enter the points it takes." };
  const amount = input.kind === "amount" ? parseDollars(input.amount) : null;
  if (input.kind === "amount" && (!amount || amount > 100_000)) return { ok: false, message: "Enter the amount off ($0.01 to $1,000)." };
  const pct = input.kind === "percent" ? whole(input.percent, 1, 100) : null;
  if (input.kind === "percent" && !pct) return { ok: false, message: "Enter the percent off (1 to 100)." };
  if (input.kind === "free_service" && !isUuid(input.serviceId)) return { ok: false, message: "Choose the free service." };
  const max = input.maxPerYear.trim() ? whole(input.maxPerYear, 1, 365) : null;
  if (input.maxPerYear.trim() && !max) return { ok: false, message: "Enter how many times a year (1 to 365), or leave it empty." };
  const { error } = await supabase.rpc("save_reward", {
    p_business_id: me.business_id,
    p_reward: {
      id: input.id && isUuid(input.id) ? input.id : null,
      name,
      points,
      kind: input.kind,
      amount_cents: amount,
      percent: pct,
      applies_services: input.kind === "free_service" || input.appliesTo !== "retail",
      applies_retail: input.kind !== "free_service" && input.appliesTo !== "services",
      service_ids: input.kind === "free_service" ? [input.serviceId] : input.serviceId && isUuid(input.serviceId) ? [input.serviceId] : null,
      max_per_year: max,
      min_tier_id: isUuid(input.minTierId) ? input.minTierId : null,
      is_active: input.isActive,
    },
  });
  if (error) return failed(error);
  revalidatePath("/settings/rewards");
  return { ok: true, message: "Saved." };
}
