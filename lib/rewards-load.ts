// Loading the rewards program: the salon's settings, tiers and catalog,
// and a client's points (client_rewards, front of house). The database
// checks it all again when a reward is taken (complete_sale).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import {
  KIND_LABEL,
  BONUS_LABEL,
  PROGRAM_COLUMNS,
  REWARD_COLUMNS,
  TIER_COLUMNS,
  programOf,
  rewardOf,
  rewardsOverview,
  tierOf,
  type ClientRewards,
  type Member,
  type ReportJson,
  type RewardsOverview,
  type PointsKind,
  type Program,
  type ProgramRow,
  type Reward,
  type RewardRow,
  type Tier,
  type TierRow,
} from "@/lib/rewards";
import { todayIn } from "@/lib/scheduling/time";
import type { RewardRates } from "@/lib/ticket";

type Supabase = SupabaseClient<Database>;

export type RewardSettings = { program: Program; tiers: Tier[]; catalog: Reward[]; inactive: Reward[] };

export async function loadRewardSettings(supabase: Supabase, businessId: string): Promise<RewardSettings> {
  const [program, tiers, rewards] = await Promise.all([
    supabase.from("reward_programs").select(PROGRAM_COLUMNS).eq("business_id", businessId).maybeSingle(),
    supabase.from("reward_tiers").select(TIER_COLUMNS).eq("business_id", businessId).order("threshold"),
    supabase.from("rewards").select(`${REWARD_COLUMNS}, is_active`).eq("business_id", businessId).order("points"),
  ]);
  if (program.error) throw program.error;
  if (tiers.error) throw tiers.error;
  if (rewards.error) throw rewards.error;
  const rows = rewards.data as unknown as (RewardRow & { is_active: boolean })[];
  return {
    program: programOf(program.data as ProgramRow | null),
    tiers: (tiers.data as TierRow[]).map(tierOf),
    catalog: rows.filter((r) => r.is_active).map(rewardOf),
    inactive: rows.filter((r) => !r.is_active).map(rewardOf),
  };
}

export type ClientSummary = ClientRewards & { spendCents: number; visits: number; referralCode: string | null; lastEarnedAt: string | null };

type SummaryJson = { balance: number; tier_id: string | null; spend_cents: number; visits: number; used_this_year: Record<string, number>; referral_code: string | null; last_earned_at: string | null };

export function summaryOf(j: SummaryJson): ClientSummary {
  return {
    balance: j.balance,
    tierId: j.tier_id,
    usedThisYear: j.used_this_year ?? {},
    spendCents: j.spend_cents,
    visits: j.visits,
    referralCode: j.referral_code,
    lastEarnedAt: j.last_earned_at,
  };
}

// A client's points, tier and uses (front of house).
export async function loadClientRewards(supabase: Supabase, clientId: string): Promise<ClientSummary> {
  const { data, error } = await supabase.rpc("client_rewards", { p_client_id: clientId });
  if (error) throw error;
  return summaryOf(data as unknown as SummaryJson);
}

// What the checkout needs (null when the program is off or there's no client).
export async function rewardRatesFor(supabase: Supabase, businessId: string, clientId: string | null): Promise<RewardRates | null> {
  if (!clientId) return null;
  const settings = await loadRewardSettings(supabase, businessId);
  if (!settings.program.enabled) return null;
  const client = await loadClientRewards(supabase, clientId);
  return { program: settings.program, tiers: settings.tiers, catalog: settings.catalog, client };
}

export type PointsEntry = { id: string; at: string; delta: number; kind: PointsKind; label: string; reason: string | null; saleId: string | null; by: string | null };

// A client's points history, newest first.
export async function loadPointsHistory(supabase: Supabase, clientId: string, limit = 50): Promise<PointsEntry[]> {
  const { data, error } = await supabase
    .from("reward_points")
    .select("id, created_at, delta, kind, bonus, reason, sale_id, reward:rewards(name), staff:staff(first_name)")
    .eq("client_id", clientId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data.map((r) => ({
    id: r.id,
    at: r.created_at,
    delta: r.delta,
    kind: r.kind as PointsKind,
    label: entryLabel(r.kind as PointsKind, r.bonus, r.reward?.name ?? null),
    reason: r.reason,
    saleId: r.sale_id,
    by: r.staff?.first_name ?? null,
  }));
}

export function entryLabel(kind: PointsKind, bonus: string | null, reward: string | null): string {
  if (kind === "bonus" && bonus) return BONUS_LABEL[bonus] ?? KIND_LABEL.bonus;
  if ((kind === "redeem" || kind === "restore") && reward) return `${KIND_LABEL[kind]}: ${reward}`;
  return KIND_LABEL[kind];
}

// The program for a period (the reports permission): points earned,
// redeemed and expired, what's outstanding, members by tier, referrals and
// the top tier's clients.
export async function loadRewardsOverview(supabase: Supabase, businessId: string, from: Date, to: Date): Promise<{ settings: RewardSettings; overview: RewardsOverview } | null> {
  const settings = await loadRewardSettings(supabase, businessId);
  if (!settings.program.enabled) return null;
  const [report, members] = await Promise.all([
    supabase.rpc("rewards_report", { p_business_id: businessId, p_from: from.toISOString(), p_to: to.toISOString() }),
    supabase.rpc("reward_members", { p_business_id: businessId }),
  ]);
  if (report.error) throw report.error;
  if (members.error) throw members.error;
  const list: Member[] = members.data.map((m) => ({ clientId: m.client_id, firstName: m.first_name, balance: m.balance, tierId: m.tier_id, spendCents: m.spend_cents, visits: m.visits }));
  return { settings, overview: rewardsOverview(report.data as unknown as ReportJson, list, settings.tiers, settings.catalog) };
}

// The nightly part (service role): birthday bonuses on the salon's own
// date, and points expiring after the months set without earning.
export async function runRewardJobs(admin: Supabase, now = new Date()): Promise<{ birthdays: number; expired: number }> {
  const { data, error } = await admin.from("reward_programs").select("business_id, business:businesses(locations(timezone))").eq("enabled", true);
  if (error) throw error;
  let birthdays = 0;
  let expired = 0;
  for (const p of data) {
    const tz = p.business?.locations[0]?.timezone ?? "America/Chicago";
    const { data: r, error: e } = await admin.rpc("run_reward_jobs", { p_business_id: p.business_id, p_today: todayIn(tz, now) });
    if (e) throw e;
    const counts = r as { birthdays: number; expired: number };
    birthdays += counts.birthdays;
    expired += counts.expired;
  }
  return { birthdays, expired };
}
