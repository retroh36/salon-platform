// Commission (pure, unit-tested): the one calculation behind payroll, My
// day's live earnings and the estimate for a visit not yet checked out.
//
// A plan (commission_plan_versions.rules) pays service and retail sales by
// tiers, in one of two styles: marginal, each dollar at the rate of the
// tier it falls in (the first $4,000 at 40% and the rest at 45%), or
// retroactive, where reaching a tier pays all the window's sales at its
// rate (so the sale that crosses $4,000 also lifts the earlier ones). The
// tiers start again each pay period or each month. A back-bar fee comes
// off each service before commission. Hourly plans pay no service
// commission (their hours are paid at their own rate). Lines without a
// plan pay their own recorded rate, as before.

import type { LocalDate } from "./scheduling/time.ts";

export type Tier = { fromCents: number; pct: number };
export type PayMode = "commission" | "hourly";
export type TierPeriod = "pay_period" | "month";
export type TierStyle = "marginal" | "retroactive";
export type Backbar = { kind: "none" } | { kind: "fixed"; cents: number } | { kind: "percent"; pct: number };

export type PlanRules = {
  mode: PayMode;
  service: Tier[];
  retail: Tier[];
  tierPeriod: TierPeriod;
  tierStyle: TierStyle;
  backbar: Backbar;
};

// The stored shape (snake_case jsonb) to ours.
export function parseRules(raw: unknown): PlanRules {
  const r = raw as {
    mode: PayMode;
    service: { from_cents: number; pct: number }[];
    retail: { from_cents: number; pct: number }[];
    tier_period: TierPeriod;
    tier_style?: TierStyle;
    backbar: { kind: "none" | "fixed" | "percent"; value?: number };
  };
  const tiers = (list: { from_cents: number; pct: number }[]) => list.map((t) => ({ fromCents: Number(t.from_cents), pct: Number(t.pct) }));
  const backbar: Backbar =
    r.backbar.kind === "fixed" ? { kind: "fixed", cents: Number(r.backbar.value) } : r.backbar.kind === "percent" ? { kind: "percent", pct: Number(r.backbar.value) } : { kind: "none" };
  return {
    mode: r.mode,
    service: tiers(r.service),
    retail: tiers(r.retail),
    tierPeriod: r.tier_period,
    tierStyle: r.tier_style === "retroactive" ? "retroactive" : "marginal",
    backbar,
  };
}

export function rulesJson(rules: PlanRules) {
  const tiers = (list: Tier[]) => list.map((t) => ({ from_cents: t.fromCents, pct: t.pct }));
  return {
    mode: rules.mode,
    service: tiers(rules.service),
    retail: tiers(rules.retail),
    tier_period: rules.tierPeriod,
    tier_style: rules.tierStyle,
    backbar: rules.backbar.kind === "fixed" ? { kind: "fixed", value: rules.backbar.cents } : rules.backbar.kind === "percent" ? { kind: "percent", value: rules.backbar.pct } : { kind: "none" },
  };
}

// The tiers that actually pay for a kind of sale under a plan.
export function effectiveTiers(rules: PlanRules, kind: "service" | "product"): Tier[] {
  if (rules.mode === "hourly" && kind === "service") return [{ fromCents: 0, pct: 0 }];
  return kind === "service" ? rules.service : rules.retail;
}

// Commission (in cents, unrounded) on everything up to `amount` in the
// tier window: marginal, each dollar at its own tier's rate; retroactive,
// all of it at the rate of the tier reached. Below zero (refunds ahead of
// sales) goes at the first rate.
export function tieredCommission(tiers: readonly Tier[], amount: number, style: TierStyle = "marginal"): number {
  if (amount <= 0) return (amount * (tiers[0]?.pct ?? 0)) / 100;
  if (style === "retroactive") return (amount * tierAt(tiers, amount).pct) / 100;
  let total = 0;
  for (let i = 0; i < tiers.length; i++) {
    const from = tiers[i].fromCents;
    const to = tiers[i + 1]?.fromCents ?? Infinity;
    if (amount <= from) break;
    total += ((Math.min(amount, to) - from) * tiers[i].pct) / 100;
  }
  return total;
}

// The fee for a whole service line as sold (fixed per service, or a share).
export function backbarFee(backbar: Backbar, soldCents: number, quantity: number): number {
  if (soldCents <= 0) return 0;
  if (backbar.kind === "fixed") return Math.min(soldCents, backbar.cents * Math.max(1, quantity));
  if (backbar.kind === "percent") return Math.round((soldCents * backbar.pct) / 100);
  return 0;
}

// One line to pay on: its amount in this ticket (negative for refunds and
// voids), what the whole line sold for (to share the fee), and its plan
// version (null: its own recorded rate).
export type PayInput = {
  at: string;
  kind: "service" | "product";
  cents: number;
  soldCents: number;
  quantity: number;
  pct: number;
  versionId: string | null;
};

export type LinePay = { feeCents: number; commissionCents: number; pct: number };

export type Basis = { service: number; product: number };

// Pays each line in time order. `windowOf` says which tier window a moment
// is in (the pay period, or its month); `prior` is what already counts
// toward each window from before these lines (sales earlier in the month).
// Returns the unrounded pay per line, so totals round once.
export function payLines(
  lines: readonly PayInput[],
  rulesFor: (versionId: string) => PlanRules | null,
  windowOf: (at: string, rules: PlanRules) => string,
  prior: (window: string) => Basis = () => ({ service: 0, product: 0 }),
): LinePay[] {
  const basis = new Map<string, Basis>();
  const order = lines.map((l, i) => ({ l, i })).sort((a, b) => a.l.at.localeCompare(b.l.at) || a.i - b.i);
  const out: LinePay[] = new Array(lines.length);
  for (const { l, i } of order) {
    const rules = l.versionId ? rulesFor(l.versionId) : null;
    if (!rules) {
      out[i] = { feeCents: 0, commissionCents: (l.cents * l.pct) / 100, pct: l.pct };
      continue;
    }
    const window = windowOf(l.at, rules);
    const so = basis.get(window) ?? { ...prior(window) };
    const before = so[l.kind];
    const after = before + l.cents;
    so[l.kind] = after;
    basis.set(window, so);
    const fee = l.kind === "service" && rules.mode !== "hourly" && l.soldCents > 0 ? (backbarFee(rules.backbar, l.soldCents, l.quantity) * l.cents) / l.soldCents : 0;
    const tiers = effectiveTiers(rules, l.kind);
    const earned = tieredCommission(tiers, after, rules.tierStyle) - tieredCommission(tiers, before, rules.tierStyle);
    // The rate those dollars earned, on what's left after the fee.
    const commission = l.cents === 0 ? 0 : (earned * (l.cents - fee)) / l.cents;
    out[i] = { feeCents: fee, commissionCents: commission, pct: l.cents === 0 ? tiers[0].pct : Math.round((earned / l.cents) * 10000) / 100 };
  }
  return out;
}

// The rate in effect at a basis, and the next tier up (null at the top).
export function tierAt(tiers: readonly Tier[], basis: number): { pct: number; next: { pct: number; neededCents: number } | null } {
  let current = tiers[0];
  let next: Tier | null = null;
  for (const t of tiers) {
    if (t.fromCents <= basis) current = t;
    else {
      next = t;
      break;
    }
  }
  return { pct: current.pct, next: next ? { pct: next.pct, neededCents: next.fromCents - basis } : null };
}

const dollarsText = (cents: number) => `$${Math.ceil(cents / 100).toLocaleString("en-US")}`;

// "You're $412 from 45% on services (this month)." Retroactive tiers also
// say what reaching it adds to what's already sold (before back-bar fees):
// "… which lifts everything this month to 45%: about $179 more."
export function nextTierText(kind: "service" | "product", rules: PlanRules, basis: number): string | null {
  if (rules.mode === "hourly" && kind === "service") return null;
  const { pct, next } = tierAt(kind === "service" ? rules.service : rules.retail, basis);
  if (!next) return null;
  const window = rules.tierPeriod === "month" ? "this month" : "this pay period";
  const base = `You're ${dollarsText(next.neededCents)} from ${next.pct}% on ${kind === "service" ? "services" : "retail"} (${window})`;
  if (rules.tierStyle === "marginal" || basis <= 0) return `${base}.`;
  const lift = Math.round((basis * (next.pct - pct)) / 100);
  return `${base}, which lifts everything ${window} to ${next.pct}%: about ${dollarsText(lift)} more.`;
}

// A worked example for the plan page: what a month (or period) a quarter
// past the second tier pays in services, in this plan's style.
export function tierExample(rules: PlanRules): string | null {
  const tiers = effectiveTiers(rules, "service");
  if (tiers.length < 2) return null;
  const amount = Math.round((tiers[1].fromCents * 1.25) / 10_000) * 10_000;
  const window = rules.tierPeriod === "month" ? "a month" : "a pay period";
  return `${dollarsText(amount)} in services in ${window} pays ${dollarsText(tieredCommission(tiers, amount, rules.tierStyle))} before back-bar fees.`;
}

export const monthStart = (date: LocalDate): LocalDate => `${date.slice(0, 7)}-01`;


export const MODE_LABELS: Record<PayMode, string> = { commission: "Commission", hourly: "Hourly" };

export const STYLE_LABELS: Record<TierStyle, string> = {
  marginal: "Marginal: each dollar at its tier's rate",
  retroactive: "Retroactive: reaching a tier pays all sales at its rate",
};

// "40% to $4,000, then 45%", or "40%".
export function tiersText(tiers: readonly Tier[]): string {
  if (tiers.length === 1) return `${tiers[0].pct}%`;
  return tiers
    .map((t, i) => {
      const upTo = tiers[i + 1];
      return upTo ? `${t.pct}% to $${(upTo.fromCents / 100).toLocaleString("en-US")}` : `then ${t.pct}%`;
    })
    .join(", ");
}

export function planSummary(rules: PlanRules): string {
  const fee =
    rules.backbar.kind === "fixed"
      ? `, $${(rules.backbar.cents / 100).toFixed(2).replace(/\.00$/, "")} back-bar fee per service`
      : rules.backbar.kind === "percent"
        ? `, ${rules.backbar.pct}% back-bar fee per service`
        : "";
  const each = rules.tierPeriod === "month" ? "month" : "pay period";
  const tiered = (rules.mode === "commission" && rules.service.length > 1) || rules.retail.length > 1;
  const tierWord = tiered
    ? `; ${rules.tierStyle === "retroactive" ? `reaching a tier pays all of the ${each}'s sales at its rate` : "each dollar at its tier's rate"}, starting again each ${each}`
    : "";
  if (rules.mode === "hourly") return `Hourly, at their own rate; retail ${tiersText(rules.retail)}${tierWord}`;
  return `Services ${tiersText(rules.service)}; retail ${tiersText(rules.retail)}${fee}${tierWord}`;
}

// The plan form: dollars and percents as typed.
export type PlanInput = {
  name: string;
  isDefault: boolean;
  mode: PayMode;
  tierPeriod: TierPeriod;
  tierStyle: TierStyle;
  service: { from: string; pct: string }[];
  retail: { from: string; pct: string }[];
  backbarKind: Backbar["kind"];
  backbarValue: string;
};

const MODES: PayMode[] = ["commission", "hourly"];

export function parsePlanInput(input: PlanInput): { ok: true; name: string; isDefault: boolean; rules: PlanRules } | { ok: false; message: string } {
  const name = input.name.trim();
  if (!name || name.length > 60) return { ok: false, message: "Give the plan a name (up to 60 characters)." };
  if (!MODES.includes(input.mode)) return { ok: false, message: "Choose how they're paid." };
  if (input.tierPeriod !== "pay_period" && input.tierPeriod !== "month") return { ok: false, message: "Choose when the tiers start again." };
  if (input.tierStyle !== "marginal" && input.tierStyle !== "retroactive") return { ok: false, message: "Choose how the tiers pay." };
  const money = (v: string) => (/^\d+(\.\d{1,2})?$/.test(v.trim().replace(/[$,]/g, "")) ? Math.round(Number(v.trim().replace(/[$,]/g, "")) * 100) : null);
  const percent = (v: string) => (/^\d+(\.\d{1,2})?$/.test(v.trim().replace("%", "")) ? Number(v.trim().replace("%", "")) : null);
  const tiers = (rows: { from: string; pct: string }[], label: string): Tier[] | string => {
    if (rows.length < 1 || rows.length > 6) return `Give ${label} one to six tiers.`;
    const out: Tier[] = [];
    for (const [i, row] of rows.entries()) {
      const fromCents = i === 0 ? 0 : money(row.from);
      const pct = percent(row.pct);
      if (fromCents === null || pct === null || pct > 100) return `Each ${label} tier needs a starting amount and a rate from 0 to 100%.`;
      if (i > 0 && fromCents <= out[i - 1].fromCents) return `Each ${label} tier starts above the one before.`;
      out.push({ fromCents, pct });
    }
    return out;
  };
  const service = input.mode === "commission" ? tiers(input.service, "service") : [{ fromCents: 0, pct: 0 }];
  if (typeof service === "string") return { ok: false, message: service };
  const retail = tiers(input.retail, "retail");
  if (typeof retail === "string") return { ok: false, message: retail };
  let backbar: Backbar = { kind: "none" };
  if (input.mode !== "hourly" && input.backbarKind === "fixed") {
    const cents = money(input.backbarValue);
    if (!cents || cents > 10_000) return { ok: false, message: "Give the back-bar fee as $0.01 to $100 per service." };
    backbar = { kind: "fixed", cents };
  } else if (input.mode !== "hourly" && input.backbarKind === "percent") {
    const pct = percent(input.backbarValue);
    if (!pct || pct < 1 || pct > 50) return { ok: false, message: "Give the back-bar fee as 1 to 50% of each service." };
    backbar = { kind: "percent", pct };
  }
  return { ok: true, name, isDefault: input.isDefault, rules: { mode: input.mode, service, retail, tierPeriod: input.tierPeriod, tierStyle: input.tierStyle, backbar } };
}

// A saved plan back into the form.
export function planInput(name: string, isDefault: boolean, rules: PlanRules): PlanInput {
  const rows = (tiers: Tier[]) => tiers.map((t) => ({ from: String(t.fromCents / 100), pct: String(t.pct) }));
  return {
    name,
    isDefault,
    mode: rules.mode,
    tierPeriod: rules.tierPeriod,
    tierStyle: rules.tierStyle,
    service: rules.mode === "commission" ? rows(rules.service) : [{ from: "0", pct: "40" }],
    retail: rows(rules.retail),
    backbarKind: rules.backbar.kind,
    backbarValue: rules.backbar.kind === "fixed" ? String(rules.backbar.cents / 100) : rules.backbar.kind === "percent" ? String(rules.backbar.pct) : "",
  };
}

export const NEW_PLAN: PlanInput = {
  name: "",
  isDefault: false,
  mode: "commission",
  tierPeriod: "pay_period",
  tierStyle: "marginal",
  service: [{ from: "0", pct: "40" }],
  retail: [{ from: "0", pct: "10" }],
  backbarKind: "none",
  backbarValue: "",
};
