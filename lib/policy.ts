// The salon's cancellation and no-show policy (pure, unit-tested): when a
// card is needed to book, the terms for a visit (the salon's rules, made
// stricter by any stylist on it), what a late cancellation or no-show
// costs, repeat offenders, and the plain-language policy clients agree to.
// The database works the fee out the same way when it happens
// (private.visit_terms, trigger appointments_policy_fee); tests check they
// agree. Messages to clients are fixed templates, never AI-written.

export type FeeKind = "none" | "fixed" | "percent" | "deposit";
export type CardRule = "off" | "all" | "new_clients" | "some";
export type RepeatAction = "off" | "deposit" | "prepay";
export type FeeRule = { kind: FeeKind; amount: number };

export type PolicySettings = {
  cardRequired: CardRule;
  cardServiceIds: readonly string[];
  cardStaffIds: readonly string[];
  windowHours: number;
  lateCancel: FeeRule;
  noShow: FeeRule;
  // When set, the late-cancel fee applies only to visits booked at least
  // this many days ahead (a deposit is kept either way).
  longHoldDays: number | null;
  repeatCount: number;
  repeatMonths: number;
  repeatAction: RepeatAction;
  repeatDepositPercent: number;
};

// A stylist's own, stricter rules (null: the salon's).
export type StaffPolicy = { staffId: string; windowHours: number | null; lateCancel: FeeRule | null; noShow: FeeRule | null };

export const DEFAULT_POLICY: PolicySettings = {
  cardRequired: "off",
  cardServiceIds: [],
  cardStaffIds: [],
  windowHours: 24,
  lateCancel: { kind: "none", amount: 0 },
  noShow: { kind: "none", amount: 0 },
  longHoldDays: null,
  repeatCount: 2,
  repeatMonths: 6,
  repeatAction: "off",
  repeatDepositPercent: 50,
};

// A deposit paid ahead comes off the bill at checkout as a card payment
// with this reference (the database checks it's the visit's own deposit).
export const DEPOSIT_REFERENCE = "Deposit paid online";

// How long after a no-show or late cancellation the card is charged, so a
// mistake can be undone or the fee waived first.
export const CHARGE_GRACE_MINUTES = 10;

// Cancel reasons (lib/appointments.ts CANCEL_REASONS) that mean the client
// called it off; the salon canceling never costs the client anything.
export const CLIENT_CANCEL_REASONS = ["Client canceled", "Client is sick", "Canceled online by the client"] as const;

export const isClientCancel = (reason: string | null | undefined) => !!reason && CLIENT_CANCEL_REASONS.some((r) => reason === r || reason.startsWith(`${r}:`));

// One rule's fee for a visit: a fixed fee is never more than the visit.
export function feeFor(rule: FeeRule, visitCents: number, depositPaidCents: number): number {
  if (rule.kind === "fixed") return Math.min(rule.amount, visitCents);
  if (rule.kind === "percent") return Math.round((visitCents * rule.amount) / 100);
  if (rule.kind === "deposit") return depositPaidCents;
  return 0;
}

export type VisitTerms = { windowHours: number; lateCancelCents: number; noShowCents: number; longHoldDays: number | null };

// The visit's terms: the longest window and the highest fee among the
// salon and the stylists on it, so a stylist's rules only ever make it
// stricter. A paid deposit is always kept on a late cancellation or no-show.
export function visitTerms(settings: PolicySettings, stylists: readonly StaffPolicy[], visitCents: number, depositPaidCents = 0): VisitTerms {
  const windows = [settings.windowHours, ...stylists.map((s) => s.windowHours ?? 0)];
  const late = [settings.lateCancel, ...stylists.flatMap((s) => (s.lateCancel ? [s.lateCancel] : []))];
  const noShow = [settings.noShow, ...stylists.flatMap((s) => (s.noShow ? [s.noShow] : []))];
  return {
    windowHours: Math.max(...windows),
    lateCancelCents: Math.max(depositPaidCents, ...late.map((r) => feeFor(r, visitCents, depositPaidCents))),
    noShowCents: Math.max(depositPaidCents, ...noShow.map((r) => feeFor(r, visitCents, depositPaidCents))),
    longHoldDays: settings.longHoldDays,
  };
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export const isLateCancel = (startsAt: Date, canceledAt: Date, windowHours: number) => canceledAt.getTime() > startsAt.getTime() - windowHours * HOUR;

// What a cancellation costs: nothing outside the window or when the salon
// canceled; inside it, the fee (only the deposit for a visit booked less
// than the long-hold days ahead, when that rule is on).
export function cancelFee(
  terms: VisitTerms,
  visit: { startsAt: Date; bookedAt: Date; depositPaidCents: number },
  canceledAt: Date,
  reason: string | null,
): { late: boolean; feeCents: number } {
  if (!isClientCancel(reason) || !isLateCancel(visit.startsAt, canceledAt, terms.windowHours)) return { late: false, feeCents: 0 };
  const heldDays = (visit.startsAt.getTime() - visit.bookedAt.getTime()) / DAY;
  if (terms.longHoldDays !== null && heldDays < terms.longHoldDays) return { late: true, feeCents: visit.depositPaidCents };
  return { late: true, feeCents: terms.lateCancelCents };
}

// Whether booking this visit needs a card on file.
export function cardRequired(settings: PolicySettings, visit: { serviceIds: readonly string[]; staffIds: readonly string[]; newClient: boolean; repeatOffender?: boolean }): boolean {
  if (visit.repeatOffender && settings.repeatAction !== "off") return true;
  switch (settings.cardRequired) {
    case "all":
      return true;
    case "new_clients":
      return visit.newClient;
    case "some":
      return visit.serviceIds.some((id) => settings.cardServiceIds.includes(id)) || visit.staffIds.some((id) => settings.cardStaffIds.includes(id));
    default:
      return false;
  }
}

// Late cancellations and no-shows that count against a client: in the last
// repeatMonths, not waived or taken back.
export type Incident = { kind: "late_cancel" | "no_show"; status: string; createdAt: Date };

export const countsAsStrike = (i: Pick<Incident, "status">) => i.status !== "waived" && i.status !== "voided";

export function strikesSince(incidents: readonly Incident[], months: number, now = new Date()): number {
  const since = new Date(now);
  since.setUTCMonth(since.getUTCMonth() - months);
  return incidents.filter((i) => countsAsStrike(i) && i.createdAt > since).length;
}

export type Standing = { strikes: number; action: RepeatAction };

// A repeat offender has to pay ahead: a deposit (a percent of the visit) or
// the whole visit.
export function standingOf(settings: PolicySettings, strikes: number): Standing {
  return { strikes, action: settings.repeatAction !== "off" && strikes >= settings.repeatCount ? settings.repeatAction : "off" };
}

export function depositNeeded(settings: PolicySettings, standing: Standing, visitCents: number, serviceDepositCents = 0): number {
  const repeat = standing.action === "prepay" ? visitCents : standing.action === "deposit" ? Math.round((visitCents * settings.repeatDepositPercent) / 100) : 0;
  return Math.max(repeat, serviceDepositCents);
}

const dollars = (cents: number) => (cents % 100 === 0 ? `$${(cents / 100).toLocaleString("en-US")}` : `$${(cents / 100).toFixed(2)}`);
const hoursText = (h: number) => (h % 24 === 0 ? `${h / 24 === 1 ? "24 hours" : `${h / 24} days`}` : `${h} hour${h === 1 ? "" : "s"}`);

function feeText(rule: FeeRule, cents: number | null): string | null {
  if (rule.kind === "fixed") return cents !== null ? dollars(cents) : `a ${dollars(rule.amount)} fee`;
  if (rule.kind === "percent") return cents !== null ? `${rule.amount}% of the visit (${dollars(cents)})` : `${rule.amount}% of the visit`;
  if (rule.kind === "deposit") return "your deposit";
  return null;
}

// The strictest rule for each fee, for the wording.
function strictest(rules: FeeRule[], visitCents: number | null): FeeRule {
  if (visitCents === null) return rules.find((r) => r.kind !== "none") ?? rules[0];
  return rules.reduce((best, r) => (feeFor(r, visitCents, 0) > feeFor(best, visitCents, 0) || best.kind === "none" ? r : best), rules[0]);
}

// The policy in plain language, as clients see it before agreeing. With a
// visit, its own amounts ("$40"); without one, the salon's rules ("50% of
// the visit").
export function policyText(
  settings: PolicySettings,
  options: { stylists?: readonly StaffPolicy[]; visitCents?: number | null; depositCents?: number; extra?: string; salon: string },
): string[] {
  const stylists = options.stylists ?? [];
  const visit = options.visitCents ?? null;
  const window = Math.max(settings.windowHours, ...stylists.map((s) => s.windowHours ?? 0));
  const late = strictest([settings.lateCancel, ...stylists.flatMap((s) => (s.lateCancel ? [s.lateCancel] : []))], visit);
  const noShow = strictest([settings.noShow, ...stylists.flatMap((s) => (s.noShow ? [s.noShow] : []))], visit);
  const lines = [`Please give ${options.salon} at least ${hoursText(window)}' notice if you need to cancel.`];
  const lateText = feeText(late, visit === null ? null : feeFor(late, visit, options.depositCents ?? 0));
  const noShowText = feeText(noShow, visit === null ? null : feeFor(noShow, visit, options.depositCents ?? 0));
  if (lateText) {
    lines.push(
      settings.longHoldDays
        ? `Canceling with less notice costs ${lateText} for visits booked ${settings.longHoldDays} or more days ahead.`
        : `Canceling with less notice costs ${lateText}.`,
    );
  }
  if (noShowText) lines.push(`Not showing up costs ${noShowText}.`);
  if (options.depositCents) lines.push(`Your ${dollars(options.depositCents)} deposit comes off the bill at your visit. It isn't refunded if you cancel late or don't show up.`);
  if (lateText || noShowText) lines.push("Your card is saved securely with the payment provider and only charged under this policy. You'll get a receipt if it is.");
  if (options.extra?.trim()) lines.push(options.extra.trim());
  return lines;
}

// Whether the policy costs anything (if not, there's nothing to agree to
// beyond the notice).
export const hasFees = (settings: PolicySettings, stylists: readonly StaffPolicy[] = []) =>
  [settings.lateCancel, settings.noShow, ...stylists.flatMap((s) => [s.lateCancel, s.noShow])].some((r) => r && r.kind !== "none");

// Denise's heads-up when the desk books a repeat offender (our wording, in
// her voice; nothing from Claude). "since May": their first strike in the
// window.
export function repeatOffenderNote(firstName: string, standing: Standing, settings: PolicySettings, since: string | null, hasCard: boolean): string | null {
  if (standing.action === "off") return null;
  const what = `${standing.strikes} late cancellation${standing.strikes === 1 ? "" : "s"} or no-show${standing.strikes === 1 ? "" : "s"}${since ? ` since ${since}` : ""}`;
  const ask = standing.action === "prepay" ? "the whole visit up front" : `a ${settings.repeatDepositPercent}% deposit`;
  return `Heads up: ${firstName} has ${what}, so the salon asks for ${ask}. Once it's booked, send a deposit link from booking details${hasCard ? "" : "; it saves a card too"}.`;
}

export const FEE_KIND_LABELS: Record<"late_cancel" | "no_show", string> = { late_cancel: "Late cancellation", no_show: "No-show" };

export type FeeStatus = "none" | "no_card" | "pending" | "charged" | "failed" | "waived" | "voided";

export const FEE_STATUS_LABELS: Record<FeeStatus, string> = {
  none: "No fee",
  no_card: "No card on file",
  pending: "Charging soon",
  charged: "Charged",
  failed: "Didn't go through",
  waived: "Waived",
  voided: "Taken back",
};

// The receipt the client gets when a fee is charged (a fixed template).
export function feeReceipt(salon: string, kind: "late_cancel" | "no_show", feeCents: number, cardLabel: string | null, fromDepositCents: number, when: string): { subject: string; body: string } {
  const what = kind === "no_show" ? `missed visit on ${when}` : `late cancellation of your visit on ${when}`;
  const paid = [
    fromDepositCents > 0 && `${dollars(fromDepositCents)} from your deposit`,
    feeCents - fromDepositCents > 0 && `${dollars(feeCents - fromDepositCents)} charged to ${cardLabel ?? "your card on file"}`,
  ].filter(Boolean);
  return {
    subject: `Your receipt from ${salon}`,
    body: `${salon}: as agreed in our cancellation policy, a ${dollars(feeCents)} fee was applied for the ${what} (${paid.join(" and ")}). Questions? Just reply or call us.`,
  };
}

// How long a card link works.
export const CARD_LINK_HOURS = 72;

// The message with a secure card link (a fixed template).
export function cardLinkMessage(salon: string, url: string, depositCents: number, channel: "sms" | "email"): { subject: string | null; body: string } {
  const ask = depositCents > 0 ? `please pay your ${dollars(depositCents)} deposit and add a card for your booking` : "please add a card to hold your booking";
  return {
    subject: channel === "email" ? (depositCents > 0 ? `Your deposit for ${salon}` : `Hold your booking at ${salon}`) : null,
    body: `${salon}: ${ask}. Our cancellation policy is on the page: ${url} (the link works for ${CARD_LINK_HOURS / 24} days).`,
  };
}

// Form parsing for Settings → Policies (dollars or percents, by kind).
type FormLike = { get(name: string): FormDataEntryValue | null; getAll(name: string): FormDataEntryValue[] };

function wholeNumber(value: string, min: number, max: number): number | null {
  if (!/^\d+$/.test(value.trim())) return null;
  const n = Number(value.trim());
  return n >= min && n <= max ? n : null;
}

export function parseFeeRule(kind: string, amount: string): FeeRule | string {
  if (kind === "none" || kind === "deposit") return { kind, amount: 0 };
  if (kind === "fixed") {
    const m = /^\$?\s*(\d{1,4})(?:\.(\d{1,2}))?$/.exec(amount.trim());
    if (!m) return "Enter an amount like 40.";
    const cents = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
    return cents > 0 ? { kind, amount: cents } : "Enter an amount like 40.";
  }
  if (kind === "percent") {
    const pct = wholeNumber(amount.replace(/%$/, ""), 1, 100);
    return pct === null ? "Enter a percentage from 1 to 100." : { kind, amount: pct };
  }
  return "Choose a fee.";
}

export type PolicyErrors = Partial<Record<"windowHours" | "lateCancel" | "noShow" | "longHoldDays" | "repeatCount" | "repeatMonths" | "repeatDepositPercent" | "cardRequired", string>>;

export function parsePolicyForm(form: FormLike): { ok: true; value: PolicySettings } | { ok: false; errors: PolicyErrors } {
  const errors: PolicyErrors = {};
  const text = (name: string) => String(form.get(name) ?? "").trim();
  const card = text("card_required") as CardRule;
  if (!["off", "all", "new_clients", "some"].includes(card)) errors.cardRequired = "Choose when a card is needed.";
  const cardServiceIds = form.getAll("card_service_ids").map(String);
  const cardStaffIds = form.getAll("card_staff_ids").map(String);
  if (card === "some" && !cardServiceIds.length && !cardStaffIds.length) errors.cardRequired = "Choose at least one service or stylist.";
  const windowHours = wholeNumber(text("window_hours"), 1, 168);
  if (windowHours === null) errors.windowHours = "Enter 1 to 168 hours.";
  const late = parseFeeRule(text("late_kind"), text("late_amount"));
  if (typeof late === "string") errors.lateCancel = late;
  const noShow = parseFeeRule(text("no_show_kind"), text("no_show_amount"));
  if (typeof noShow === "string") errors.noShow = noShow;
  const longHold = text("long_hold_days") ? wholeNumber(text("long_hold_days"), 1, 365) : null;
  if (text("long_hold_days") && longHold === null) errors.longHoldDays = "Enter 1 to 365 days, or leave it empty.";
  const repeatAction = text("repeat_action") as RepeatAction;
  const repeatCount = wholeNumber(text("repeat_count") || "2", 1, 10);
  if (repeatCount === null) errors.repeatCount = "Enter 1 to 10.";
  const repeatMonths = wholeNumber(text("repeat_months") || "6", 1, 24);
  if (repeatMonths === null) errors.repeatMonths = "Enter 1 to 24 months.";
  const repeatDepositPercent = wholeNumber(text("repeat_deposit_percent") || "50", 1, 100);
  if (repeatDepositPercent === null) errors.repeatDepositPercent = "Enter a percentage from 1 to 100.";
  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      cardRequired: card,
      cardServiceIds: card === "some" ? cardServiceIds : [],
      cardStaffIds: card === "some" ? cardStaffIds : [],
      windowHours: windowHours!,
      lateCancel: late as FeeRule,
      noShow: noShow as FeeRule,
      longHoldDays: longHold,
      repeatCount: repeatCount!,
      repeatMonths: repeatMonths!,
      repeatAction: ["deposit", "prepay"].includes(repeatAction) ? repeatAction : "off",
      repeatDepositPercent: repeatDepositPercent!,
    },
  };
}

// The database row as settings.
export type PolicyRow = {
  card_required: string;
  card_service_ids: string[];
  card_staff_ids: string[];
  cancel_window_hours: number;
  late_cancel_fee_kind: string;
  late_cancel_fee_amount: number;
  no_show_fee_kind: string;
  no_show_fee_amount: number;
  long_hold_days: number | null;
  repeat_count: number;
  repeat_months: number;
  repeat_action: string;
  repeat_deposit_percent: number;
};

export function policyFromRow(row: PolicyRow | null | undefined): PolicySettings {
  if (!row) return DEFAULT_POLICY;
  return {
    cardRequired: row.card_required as CardRule,
    cardServiceIds: row.card_service_ids,
    cardStaffIds: row.card_staff_ids,
    windowHours: row.cancel_window_hours,
    lateCancel: { kind: row.late_cancel_fee_kind as FeeKind, amount: row.late_cancel_fee_amount },
    noShow: { kind: row.no_show_fee_kind as FeeKind, amount: row.no_show_fee_amount },
    longHoldDays: row.long_hold_days,
    repeatCount: row.repeat_count,
    repeatMonths: row.repeat_months,
    repeatAction: row.repeat_action as RepeatAction,
    repeatDepositPercent: row.repeat_deposit_percent,
  };
}

export type StaffPolicyRow = {
  staff_id: string;
  cancel_window_hours: number | null;
  late_cancel_fee_kind: string | null;
  late_cancel_fee_amount: number | null;
  no_show_fee_kind: string | null;
  no_show_fee_amount: number | null;
};

export const staffPolicyFromRow = (r: StaffPolicyRow): StaffPolicy => ({
  staffId: r.staff_id,
  windowHours: r.cancel_window_hours,
  lateCancel: r.late_cancel_fee_kind ? { kind: r.late_cancel_fee_kind as FeeKind, amount: r.late_cancel_fee_amount ?? 0 } : null,
  noShow: r.no_show_fee_kind ? { kind: r.no_show_fee_kind as FeeKind, amount: r.no_show_fee_amount ?? 0 } : null,
});
