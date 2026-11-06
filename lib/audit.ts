import { addDays, isLocalDate, type LocalDate } from "@/lib/scheduling/time";

// The Audit page (`/audit`, the `audit` permission): who changed what,
// from the logs the database keeps (visit changes, sale events, gift card
// and fee events, points adjustments, pay rates, going live, data
// downloads, team purchases, payments taken as "Other", drawer counts that were off and skipped ones), newest first, by type, person and dates. Pure.

export const AUDIT_TYPES = [
  { key: "visits", label: "Visits" },
  { key: "sales", label: "Sales, voids and refunds" },
  { key: "discounts", label: "Discounts and $0 sales" },
  { key: "team", label: "Team purchases" },
  { key: "other", label: "Paid by other" },
  { key: "drawer", label: "Cash drawer" },
  { key: "gift_cards", label: "Gift cards" },
  { key: "fees", label: "Cancellation fees" },
  { key: "points", label: "Rewards points" },
  { key: "pay", label: "Pay rates" },
  { key: "clock", label: "Clocked hours" },
  { key: "settings", label: "Going live and data downloads" },
] as const;

export type AuditType = (typeof AUDIT_TYPES)[number]["key"];

export type AuditRow = {
  id: string;
  at: string;
  type: AuditType;
  // A team member's id, or null for the client themselves or Maestra.
  staffId: string | null;
  who: string;
  what: string;
  href: string | null;
};

export type AuditFilters = { type: AuditType | null; staffId: string | null; from: LocalDate; to: LocalDate };

// The most rows the page shows at once (newest first).
export const AUDIT_LIMIT = 300;
// The longest range at once.
export const AUDIT_MAX_DAYS = 92;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// From the address: the last 7 days by default, never more than
// AUDIT_MAX_DAYS, never backwards.
export function parseAuditFilters(params: Record<string, string | string[] | undefined>, today: LocalDate): AuditFilters {
  const one = (k: string) => (typeof params[k] === "string" ? (params[k] as string) : "");
  const type = AUDIT_TYPES.find((t) => t.key === one("type"))?.key ?? null;
  const staffId = UUID.test(one("staff")) ? one("staff") : null;
  let to = isLocalDate(one("to")) ? one("to") : today;
  if (to > today) to = today;
  let from = isLocalDate(one("from")) ? one("from") : addDays(to, -6);
  if (from > to) from = to;
  if (from < addDays(to, -(AUDIT_MAX_DAYS - 1))) from = addDays(to, -(AUDIT_MAX_DAYS - 1));
  return { type, staffId, from, to };
}

// Newest first, at most the limit, and whether more were left out.
export function mergeAudit(groups: AuditRow[][], limit = AUDIT_LIMIT): { rows: AuditRow[]; more: boolean } {
  const all = groups.flat().sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id));
  return { rows: all.slice(0, limit), more: all.length > limit };
}

// The link to the same list for a CSV-free share: the filters as a query.
export function auditHref(f: Partial<AuditFilters>): string {
  const q = new URLSearchParams();
  if (f.type) q.set("type", f.type);
  if (f.staffId) q.set("staff", f.staffId);
  if (f.from) q.set("from", f.from);
  if (f.to) q.set("to", f.to);
  const s = q.toString();
  return s ? `/audit?${s}` : "/audit";
}
