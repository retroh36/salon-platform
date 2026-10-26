// Promotions and last-minute specials (pure, unit-tested). The database
// applies them the same way in complete_sale (private.promotion_problem,
// private.promotion_applies), and these mirror it for the checkout screen,
// the online booking review and the reports.
//
// A promotion takes a percent or an amount off the services and/or retail
// it covers (by service, category, stylist, level or product; never
// gift cards, packages, memberships or services already paid with a
// package or membership). It's a code (given at the desk or entered
// online), automatic (offered at checkout by itself), or a last-minute
// special (open time in the next N hours, shown with a badge on the
// booking site). Member prices come off first, then promotions in order,
// each on what's left, then any discount staff give.

import type { LocalDate } from "./scheduling/time.ts";

export type PromoKind = "code" | "automatic" | "last_minute";
export type Level = "artisan" | "senior" | "master";
export type Exclusion = { level: Level | null; category: string | null };
// "line": the first line it covers, in full (a reward's free service).
export type PromoDiscount = { kind: "percent"; pct: number } | { kind: "amount"; cents: number } | { kind: "line" };

export type PromoRule = {
  id: string;
  name: string;
  kind: PromoKind;
  code: string | null;
  discount: PromoDiscount;
  services: boolean;
  retail: boolean;
  // null: any.
  serviceIds: string[] | null;
  categories: string[] | null;
  staffIds: string[] | null;
  levels: Level[] | null;
  // Never these: a level, a category, or both together ("never Master
  // color": { level: "master", category: "Color" }).
  exclusions: Exclusion[];
  productIds: string[] | null;
  startsOn: LocalDate | null;
  endsOn: LocalDate | null;
  maxUses: number | null;
  maxPerClient: number | null;
  // New to the salon: their client record was added on or after the start.
  newClientsOnly: boolean;
  // Only on the client's first visit (no visit checked out before).
  firstVisitOnly: boolean;
  minSpendCents: number | null;
  // Can be used with other promotions and staff discounts.
  stackable: boolean;
  // Can be used on the booking site.
  online: boolean;
  // Last-minute specials: open time starting within this many hours.
  hoursAhead: number | null;
};

// The stored row (promotions) to ours.
export type PromotionRow = {
  id: string;
  name: string;
  kind: string;
  code: string | null;
  discount_kind: string;
  percent: number | null;
  amount_cents: number | null;
  applies_services: boolean;
  applies_retail: boolean;
  service_ids: string[] | null;
  categories: string[] | null;
  staff_ids: string[] | null;
  levels: string[] | null;
  exclusions: unknown;
  product_ids: string[] | null;
  starts_on: string | null;
  ends_on: string | null;
  max_uses: number | null;
  max_uses_per_client: number | null;
  new_clients_only: boolean;
  first_visit_only: boolean;
  min_spend_cents: number | null;
  stackable: boolean;
  online: boolean;
  hours_ahead: number | null;
};

export const PROMOTION_COLUMNS =
  "id, name, kind, code, discount_kind, percent, amount_cents, applies_services, applies_retail, service_ids, categories, staff_ids, levels, exclusions, product_ids, starts_on, ends_on, max_uses, max_uses_per_client, new_clients_only, first_visit_only, min_spend_cents, stackable, online, hours_ahead";

export function ruleOf(r: PromotionRow): PromoRule {
  return {
    id: r.id,
    name: r.name,
    kind: r.kind as PromoKind,
    code: r.code,
    discount: r.discount_kind === "amount" ? { kind: "amount", cents: Number(r.amount_cents) } : { kind: "percent", pct: Number(r.percent) },
    services: r.applies_services,
    retail: r.applies_retail,
    serviceIds: r.service_ids,
    categories: r.categories,
    staffIds: r.staff_ids,
    levels: r.levels as Level[] | null,
    exclusions: exclusionsOf(r.exclusions),
    productIds: r.product_ids,
    startsOn: r.starts_on,
    endsOn: r.ends_on,
    maxUses: r.max_uses,
    maxPerClient: r.max_uses_per_client,
    newClientsOnly: r.new_clients_only,
    firstVisitOnly: r.first_visit_only,
    minSpendCents: r.min_spend_cents,
    stackable: r.stackable,
    online: r.online,
    hoursAhead: r.hours_ahead,
  };
}

export function exclusionsOf(json: unknown): Exclusion[] {
  if (!Array.isArray(json)) return [];
  return json.flatMap((e) => {
    const level = ["artisan", "senior", "master"].includes(e?.level) ? (e.level as Level) : null;
    const category = typeof e?.category === "string" && e.category ? e.category : null;
    return level || category ? [{ level, category }] : [];
  });
}

const excluded = (e: Exclusion, level: Level | null, category: string | null) => (!e.level || e.level === level) && (!e.category || e.category === category);

// A line a promotion might cover: what's left of it after member prices.
export type PromoLine =
  | { kind: "service"; serviceId: string; category: string | null; staffId: string; level: Level | null; cents: number }
  | { kind: "product"; productId: string; cents: number }
  // Not covered by any promotion (gift cards, packages, memberships, services paid with a package).
  | { kind: "other"; cents: number };

export function promotionApplies(rule: PromoRule, line: PromoLine): boolean {
  if (line.kind === "service") {
    if (!rule.services) return false;
    if (rule.serviceIds && !rule.serviceIds.includes(line.serviceId)) return false;
    if (rule.categories && !(line.category && rule.categories.includes(line.category))) return false;
    if (rule.staffIds && !rule.staffIds.includes(line.staffId)) return false;
    if (rule.levels && !(line.level && rule.levels.includes(line.level))) return false;
    return !rule.exclusions.some((e) => excluded(e, line.level, line.category));
  }
  if (line.kind === "product") return rule.retail && (!rule.productIds || rule.productIds.includes(line.productId));
  return false;
}

// What each promotion takes off each line, in order: a percent of what's
// left of the line; an amount once per sale, spread over the lines it
// covers in order until it's used up.
export function applyPromotions(rules: readonly PromoRule[], lines: readonly PromoLine[]): { perLine: number[]; perPromotion: Record<string, number> } {
  const pool = new Map(rules.map((r) => [r.id, r.discount.kind === "amount" ? r.discount.cents : Infinity]));
  const done = new Set<string>();
  const perPromotion: Record<string, number> = Object.fromEntries(rules.map((r) => [r.id, 0]));
  const perLine = lines.map((line) => {
    let left = Math.max(0, line.cents);
    let taken = 0;
    for (const rule of rules) {
      if (left <= 0 || done.has(rule.id) || !promotionApplies(rule, line)) continue;
      const amount = rule.discount.kind === "percent" ? Math.round((left * rule.discount.pct) / 100) : Math.min(left, pool.get(rule.id)!);
      if (rule.discount.kind === "amount") pool.set(rule.id, pool.get(rule.id)! - amount);
      if (rule.discount.kind === "line") done.add(rule.id);
      perPromotion[rule.id] += amount;
      left -= amount;
      taken += amount;
    }
    return taken;
  });
  return { perLine, perPromotion };
}

export type PromoContext = {
  today: LocalDate;
  where: "checkout" | "online";
  // Uses so far (not voided): everyone's and this client's.
  uses: number;
  clientUses: number;
  client: { createdOn: LocalDate; visitedBefore: boolean } | null;
  // The sale (or visit) before any discount.
  subtotalCents: number;
  // For last-minute specials: when the visit starts and when it was booked (ms).
  visit: { startsAt: number; bookedAt: number } | null;
};

// Why a promotion can't be used here (null: it can).
export function promotionProblem(rule: PromoRule, ctx: PromoContext): string | null {
  if (ctx.where === "online" && !rule.online) return `${rule.name} can't be used online.`;
  if (rule.startsOn && ctx.today < rule.startsOn) return `${rule.name} hasn't started yet.`;
  if (rule.endsOn && ctx.today > rule.endsOn) return `${rule.name} has ended.`;
  if (rule.maxUses !== null && ctx.uses >= rule.maxUses) return `${rule.name} has been used as many times as it can be.`;
  if ((rule.newClientsOnly || rule.firstVisitOnly || rule.maxPerClient !== null) && !ctx.client) return `${rule.name} needs a client on the sale.`;
  if (rule.maxPerClient !== null && ctx.clientUses >= rule.maxPerClient) return `This client has already used ${rule.name}${rule.maxPerClient > 1 ? ` ${rule.maxPerClient} times` : ""}.`;
  if (rule.newClientsOnly && ctx.client && rule.startsOn && ctx.client.createdOn < rule.startsOn) return `${rule.name} is for new clients only.`;
  if (rule.firstVisitOnly && ctx.client?.visitedBefore) return `${rule.name} is for a client's first visit only.`;
  if (rule.minSpendCents !== null && ctx.subtotalCents < rule.minSpendCents) return `${rule.name} needs a spend of ${dollars(rule.minSpendCents)} or more.`;
  if (rule.kind === "last_minute") {
    if (!ctx.visit) return `${rule.name} is for visits booked at the last minute.`;
    if (ctx.visit.startsAt - ctx.visit.bookedAt > (rule.hoursAhead ?? 0) * 3_600_000) return `${rule.name} is for visits booked within ${rule.hoursAhead} hours of starting.`;
  }
  return null;
}

// Promotions used together: only ones that allow it, and none of those
// that don't with a staff discount.
export function stackingProblem(rules: readonly PromoRule[], staffDiscount: boolean): string | null {
  const alone = rules.find((r) => !r.stackable);
  if (alone && rules.length > 1) return `${alone.name} can't be used with another promotion.`;
  if (alone && staffDiscount) return `${alone.name} can't be used with another discount.`;
  if (new Set(rules.map((r) => r.id)).size !== rules.length) return "That promotion is already on the sale.";
  return null;
}

// A special's badge on the booking site: open time starting within its
// hours, for a visit it covers. The best percent wins.
export function specialFor(
  rules: readonly PromoRule[],
  slot: { startsAt: number; now: number; today: LocalDate },
  lines: readonly PromoLine[],
): PromoRule | null {
  const live = rules.filter(
    (r) =>
      r.kind === "last_minute" &&
      r.online &&
      (!r.startsOn || slot.today >= r.startsOn) &&
      (!r.endsOn || slot.today <= r.endsOn) &&
      slot.startsAt - slot.now <= (r.hoursAhead ?? 0) * 3_600_000 &&
      lines.some((l) => promotionApplies(r, l)),
  );
  return live.sort((a, b) => applyPromotions([b], lines).perLine.reduce((x, y) => x + y, 0) - applyPromotions([a], lines).perLine.reduce((x, y) => x + y, 0))[0] ?? null;
}

export const discountText = (d: PromoDiscount) => (d.kind === "percent" ? `${d.pct}% off` : d.kind === "line" ? "Free" : `${dollars(d.cents)} off`);

// "15% off services · open time in the next 48 hours · never Master color".
export function promotionSummary(rule: PromoRule, names: { services?: Record<string, string>; staff?: Record<string, string>; products?: Record<string, string> } = {}): string {
  const what =
    rule.services && rule.retail ? "services and retail" : rule.services ? "services" : "retail";
  const parts = [`${discountText(rule.discount)} ${rule.serviceIds?.length ? rule.serviceIds.map((id) => names.services?.[id] ?? "a service").join(", ") : rule.categories?.length ? rule.categories.join(", ") : what}`];
  if (rule.kind === "last_minute") parts.push(`open time in the next ${rule.hoursAhead} hours`);
  if (rule.staffIds?.length) parts.push(`with ${rule.staffIds.map((id) => names.staff?.[id] ?? "a stylist").join(", ")}`);
  if (rule.levels?.length) parts.push(`${rule.levels.map(levelName).join(" or ")} stylists`);
  if (rule.exclusions.length) parts.push(`never ${rule.exclusions.map((e) => (e.level && e.category ? `${levelName(e.level)} ${e.category.toLowerCase()}` : e.level ? `${levelName(e.level)} stylists` : e.category)).join(" or ")}`);
  if (rule.minSpendCents) parts.push(`${dollars(rule.minSpendCents)}+ spend`);
  if (rule.newClientsOnly) parts.push("new clients");
  if (rule.firstVisitOnly) parts.push("first visit");
  if (rule.maxPerClient) parts.push(`${rule.maxPerClient === 1 ? "once" : `${rule.maxPerClient} times`} per client`);
  if (rule.maxUses) parts.push(`${rule.maxUses} uses in all`);
  if (!rule.stackable) parts.push("not with other discounts");
  return parts.join(" · ");
}

const levelName = (l: Level) => ({ artisan: "Artisan", senior: "Senior", master: "Master" })[l];

export const dollars = (cents: number) =>
  cents % 100 === 0 ? `$${(cents / 100).toLocaleString("en-US")}` : `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// The promotion form: as typed.
export type PromotionInput = {
  name: string;
  kind: PromoKind;
  code: string;
  discountKind: "percent" | "amount";
  value: string;
  services: boolean;
  retail: boolean;
  serviceIds: string[];
  categories: string[];
  staffIds: string[];
  levels: Level[];
  exclusions: Exclusion[];
  productIds: string[];
  startsOn: string;
  endsOn: string;
  maxUses: string;
  maxPerClient: string;
  newClientsOnly: boolean;
  firstVisitOnly: boolean;
  minSpend: string;
  stackable: boolean;
  online: boolean;
  hoursAhead: string;
};

export const NEW_PROMOTION: PromotionInput = {
  name: "",
  kind: "code",
  code: "",
  discountKind: "percent",
  value: "",
  services: true,
  retail: false,
  serviceIds: [],
  categories: [],
  staffIds: [],
  levels: [],
  exclusions: [],
  productIds: [],
  startsOn: "",
  endsOn: "",
  maxUses: "",
  maxPerClient: "",
  newClientsOnly: false,
  firstVisitOnly: false,
  minSpend: "",
  stackable: false,
  online: true,
  hoursAhead: "48",
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const money = (v: string) => (/^\d+(\.\d{1,2})?$/.test(v.trim().replace(/[$,]/g, "")) ? Math.round(Number(v.trim().replace(/[$,]/g, "")) * 100) : null);
const whole = (v: string) => (/^\d+$/.test(v.trim()) ? Number(v.trim()) : null);

export const normalCode = (code: string) => code.trim().toUpperCase().replace(/\s+/g, "");

// The form to what save_promotion stores (snake_case), or what's wrong.
export function parsePromotionInput(p: PromotionInput): { ok: true; row: Omit<PromotionRow, "id"> } | { ok: false; message: string } {
  const name = p.name.trim();
  if (!name || name.length > 60) return { ok: false, message: "Give the promotion a name (up to 60 characters)." };
  if (!["code", "automatic", "last_minute"].includes(p.kind)) return { ok: false, message: "Choose how it's used." };
  const code = p.kind === "code" ? normalCode(p.code) : null;
  if (p.kind === "code" && !/^[A-Z0-9_-]{3,24}$/.test(code!)) return { ok: false, message: "Give the code 3 to 24 letters or numbers." };
  let percent: number | null = null;
  let amount: number | null = null;
  if (p.discountKind === "percent") {
    const v = Number(p.value.trim().replace("%", ""));
    if (!/^\d+(\.\d{1,2})?%?$/.test(p.value.trim()) || v < 1 || v > 100) return { ok: false, message: "Give the discount as 1 to 100%." };
    percent = v;
  } else {
    amount = money(p.value);
    if (!amount || amount > 100_000) return { ok: false, message: "Give the discount as $0.01 to $1,000." };
  }
  if (!p.services && !p.retail) return { ok: false, message: "Choose services, retail or both." };
  if (p.kind === "last_minute" && !p.services) return { ok: false, message: "A last-minute special is for services." };
  if ((p.startsOn && !DATE.test(p.startsOn)) || (p.endsOn && !DATE.test(p.endsOn))) return { ok: false, message: "Enter the dates as dates." };
  if (p.startsOn && p.endsOn && p.endsOn < p.startsOn) return { ok: false, message: "It ends before it starts." };
  if (p.newClientsOnly && !p.startsOn) return { ok: false, message: "New clients only needs a start date (clients added from then)." };
  const maxUses = p.maxUses.trim() ? whole(p.maxUses) : null;
  const maxPerClient = p.maxPerClient.trim() ? whole(p.maxPerClient) : null;
  if ((p.maxUses.trim() && !maxUses) || (p.maxPerClient.trim() && !maxPerClient)) return { ok: false, message: "Give the limits as whole numbers." };
  const minSpend = p.minSpend.trim() ? money(p.minSpend) : null;
  if (p.minSpend.trim() && !minSpend) return { ok: false, message: "Give the minimum spend in dollars." };
  const hours = p.kind === "last_minute" ? whole(p.hoursAhead) : null;
  if (p.kind === "last_minute" && (!hours || hours > 168)) return { ok: false, message: "Give the hours ahead as 1 to 168." };
  const list = <T,>(v: T[]) => (v.length ? v : null);
  return {
    ok: true,
    row: {
      name,
      kind: p.kind,
      code,
      discount_kind: p.discountKind,
      percent,
      amount_cents: amount,
      applies_services: p.services,
      applies_retail: p.kind === "last_minute" ? false : p.retail,
      service_ids: p.services ? list(p.serviceIds) : null,
      categories: p.services ? list(p.categories) : null,
      staff_ids: p.services ? list(p.staffIds) : null,
      levels: p.services ? list(p.levels) : null,
      exclusions: p.services ? p.exclusions.filter((e) => e.level || e.category) : [],
      product_ids: p.retail && p.kind !== "last_minute" ? list(p.productIds) : null,
      starts_on: p.startsOn || null,
      ends_on: p.endsOn || null,
      max_uses: maxUses,
      max_uses_per_client: maxPerClient,
      new_clients_only: p.newClientsOnly,
      first_visit_only: p.firstVisitOnly,
      min_spend_cents: minSpend,
      stackable: p.stackable,
      online: p.kind === "last_minute" ? true : p.online,
      hours_ahead: hours,
    },
  };
}

export function promotionInput(r: PromotionRow): PromotionInput {
  return {
    name: r.name,
    kind: r.kind as PromoKind,
    code: r.code ?? "",
    discountKind: r.discount_kind === "amount" ? "amount" : "percent",
    value: r.discount_kind === "amount" ? String(Number(r.amount_cents) / 100) : String(Number(r.percent)),
    services: r.applies_services,
    retail: r.applies_retail,
    serviceIds: r.service_ids ?? [],
    categories: r.categories ?? [],
    staffIds: r.staff_ids ?? [],
    levels: (r.levels ?? []) as Level[],
    exclusions: exclusionsOf(r.exclusions),
    productIds: r.product_ids ?? [],
    startsOn: r.starts_on ?? "",
    endsOn: r.ends_on ?? "",
    maxUses: r.max_uses ? String(r.max_uses) : "",
    maxPerClient: r.max_uses_per_client ? String(r.max_uses_per_client) : "",
    newClientsOnly: r.new_clients_only,
    firstVisitOnly: r.first_visit_only,
    minSpend: r.min_spend_cents ? String(r.min_spend_cents / 100) : "",
    stackable: r.stackable,
    online: r.online,
    hoursAhead: r.hours_ahead ? String(r.hours_ahead) : "48",
  };
}

// The message staff send regulars about an opening (a fixed template our
// code fills in; never written by AI). Texts end with how to stop, offers
// with the opt-out link (added when it's sent).
export function specialMessage(f: { firstName: string; salon: string; stylist: string; when: string; offer: string; link: string }): string {
  return `Hi ${f.firstName}, ${f.salon} here. ${f.stylist} has an opening ${f.when}, with ${f.offer} if you book it. Book here: ${f.link}`;
}

// What each promotion brought in (Reports): redemptions, the sales they
// were on (less tax, tips and refunds), what they cost, gaps filled (visits
// booked at the last minute with a special) and new clients (redemptions
// on a client's first visit).
export type RedemptionRow = { promotionId: string; discountCents: number; saleNetCents: number; lastMinute: boolean; firstVisit: boolean };

export type PromotionResult = { promotionId: string; redemptions: number; revenueCents: number; discountCents: number; gapsFilled: number; newClients: number };

export function promotionReport(rows: readonly RedemptionRow[]): PromotionResult[] {
  const by = new Map<string, PromotionResult>();
  for (const r of rows) {
    const t = by.get(r.promotionId) ?? { promotionId: r.promotionId, redemptions: 0, revenueCents: 0, discountCents: 0, gapsFilled: 0, newClients: 0 };
    t.redemptions += 1;
    t.revenueCents += r.saleNetCents;
    t.discountCents += r.discountCents;
    if (r.lastMinute) t.gapsFilled += 1;
    if (r.firstVisit) t.newClients += 1;
    by.set(r.promotionId, t);
  }
  return [...by.values()].sort((a, b) => b.revenueCents - a.revenueCents);
}
