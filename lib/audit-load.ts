import type { SupabaseClient } from "@supabase/supabase-js";
import { AUDIT_LIMIT, mergeAudit, type AuditFilters, type AuditRow, type AuditType } from "@/lib/audit";
import type { Database } from "@/lib/database.types";
import { formatDay } from "@/lib/schedule-format";
import { addDays, fromLocal, toLocal } from "@/lib/scheduling/time";
import { formatPrice } from "@/lib/services";
import { fullName } from "@/lib/staff";
import { changeWhat, changeWho, type VisitChange } from "@/lib/visit-changes";

type Supabase = SupabaseClient<Database>;

// Every log the Audit page reads, with the signed-in person's own access
// (RLS: a log they can't read just comes back empty), for the dates and
// person chosen, merged newest first.
export async function loadAudit(supabase: Supabase, businessId: string, timeZone: string, f: AuditFilters): Promise<{ rows: AuditRow[]; more: boolean }> {
  const fromIso = fromLocal(f.from, 0, timeZone)!.toISOString();
  const toIso = fromLocal(addDays(f.to, 1), 0, timeZone)!.toISOString();
  const want = (t: AuditType) => !f.type || f.type === t;

  const [staffRows, serviceRows] = await Promise.all([
    supabase.from("staff").select("id, first_name, last_name").eq("business_id", businessId),
    supabase.from("services").select("id, name").eq("business_id", businessId),
  ]);
  if (staffRows.error) throw staffRows.error;
  if (serviceRows.error) throw serviceRows.error;
  const staff = new Map(staffRows.data.map((s) => [s.id, fullName(s)]));
  const services = new Map(serviceRows.data.map((s) => [s.id, s.name]));
  const staffName = (id: string | null | undefined) => (id ? (staff.get(id) ?? null) : null);
  const who = (id: string | null) => staffName(id) ?? (id ? "A former team member" : "Maestra");
  const day = (iso: string) => formatDay(toLocal(new Date(iso), timeZone).date);
  const client = (c: { first_name: string; last_name: string | null } | null) => (c ? `${c.first_name} ${c.last_name ?? ""}`.trim() : "a walk-in");

  const tasks: Promise<AuditRow[]>[] = [];

  if (want("visits")) {
    tasks.push(
      (async () => {
        let q = supabase
          .from("visit_changes")
          .select("id, appointment_id, kind, before, after, by_staff_id, by_kind, created_at, appointment:appointments(starts_at, client:clients(id, first_name, last_name))")
          .eq("business_id", businessId)
          .gte("created_at", fromIso)
          .lt("created_at", toIso)
          .order("created_at", { ascending: false })
          .limit(AUDIT_LIMIT + 1);
        if (f.staffId) q = q.eq("by_staff_id", f.staffId);
        const { data, error } = await q;
        if (error) throw error;
        return data.map((c) => {
          const visitClient = c.appointment?.client ?? null;
          const names = {
            staff: staffName,
            service: (id: string | null | undefined) => (id ? (services.get(id) ?? null) : null),
            client: (id: string | null | undefined) => (id && id === visitClient?.id ? client(visitClient) : id ? "another client" : null),
            timeZone,
          };
          const change = c as unknown as VisitChange;
          const visit = c.appointment ? ` · ${client(visitClient)}'s visit ${day(c.appointment.starts_at)}` : "";
          return { id: c.id, at: c.created_at, type: "visits", staffId: c.by_staff_id, who: changeWho(change, names).replace(/^\w/, (x) => x.toUpperCase()), what: `${changeWhat(change, names)}${visit}`, href: `/calendar?open=${c.appointment_id}` } satisfies AuditRow;
        });
      })(),
    );
  }

  if (want("sales") || want("discounts") || want("team")) {
    tasks.push(
      (async () => {
        let q = supabase
          .from("sale_events")
          .select("id, sale_id, kind, amount_cents, detail, staff_id, created_at, sale:sales(number, total_cents, discount_cents, discount_reason, void_reason, client:clients(first_name, last_name), employee:staff!sales_employee_id_fkey(first_name, last_name), sale_items(line_discount_cents, line_discount_reason, promo_discount_cents))")
          .eq("business_id", businessId)
          .in("kind", ["completed", "voided", "refunded", "card_refunded", "card_refund_failed"])
          .gte("created_at", fromIso)
          .lt("created_at", toIso)
          .order("created_at", { ascending: false })
          .limit(AUDIT_LIMIT + 1);
        if (f.staffId) q = q.eq("staff_id", f.staffId);
        const { data, error } = await q;
        if (error) throw error;
        const rows: AuditRow[] = [];
        for (const e of data) {
          const s = e.sale;
          const number = s ? `Sale #${s.number}` : "A sale";
          const lineOff = s?.sale_items.reduce((sum, i) => sum + i.line_discount_cents, 0) ?? 0;
          const staffOff = (s?.discount_cents ?? 0) + lineOff;
          const reasons = [s?.discount_reason, ...(s?.sale_items.map((i) => (i.line_discount_cents > 0 ? i.line_discount_reason : null)) ?? [])].filter(Boolean);
          const isDiscount = e.kind === "completed" && s !== null && (staffOff > 0 || s.total_cents === 0);
          // A team purchase is its own type, whatever its discount.
          const isTeam = e.kind === "completed" && !!s?.employee;
          const type: AuditType = isTeam ? "team" : isDiscount ? "discounts" : "sales";
          if (!want(type)) continue;
          let what: string;
          if (e.kind === "completed") {
            what = isTeam && s?.employee
              ? `${number}, team purchase for ${s.employee.first_name} ${s.employee.last_name} at the employee price, ${formatPrice(s.total_cents)}`
              : `${number} for ${client(s?.client ?? null)}, ${formatPrice(s?.total_cents ?? 0)}`;
            if (s && s.total_cents === 0) what += " ($0 sale)";
            if (staffOff > 0) what += `, ${formatPrice(staffOff)} discount${reasons.length ? ` (${[...new Set(reasons)].join("; ")})` : ""}`;
          } else if (e.kind === "voided") what = `${number} voided${s?.void_reason ? `: ${s.void_reason}` : ""}`;
          else if (e.kind === "refunded") what = `Refunded ${formatPrice(Math.abs(e.amount_cents ?? 0))} on ${number.toLowerCase()}${e.detail ? `: ${e.detail}` : ""}`;
          else if (e.kind === "card_refunded") what = `Card refunded online for ${number.toLowerCase()}`;
          else what = `Card refund didn't go through for ${number.toLowerCase()}`;
          rows.push({ id: e.id, at: e.created_at, type, staffId: e.staff_id, who: who(e.staff_id), what, href: `/sales/${e.sale_id}` });
        }
        return rows;
      })(),
    );
  }

  // Money taken as "Other" (a check, a transfer), with the note staff gave.
  if (want("other")) {
    tasks.push(
      (async () => {
        let q = supabase
          .from("payments")
          .select("id, sale_id, amount_cents, reference, created_by, created_at, sale:sales(number)")
          .eq("business_id", businessId)
          .eq("method", "other")
          .gt("amount_cents", 0)
          .gte("created_at", fromIso)
          .lt("created_at", toIso)
          .order("created_at", { ascending: false })
          .limit(AUDIT_LIMIT + 1);
        if (f.staffId) q = q.eq("created_by", f.staffId);
        const { data, error } = await q;
        if (error) throw error;
        return data.map(
          (p) =>
            ({
              id: p.id,
              at: p.created_at,
              type: "other",
              staffId: p.created_by,
              who: who(p.created_by),
              what: `Took ${formatPrice(p.amount_cents)} as "Other" on sale #${p.sale?.number ?? "?"}: ${p.reference?.trim() || "no note"}`,
              href: `/sales/${p.sale_id}`,
            }) satisfies AuditRow,
        );
      })(),
    );
  }

  // The cash drawer: opening counts skipped by a manager, and counts that
  // were off.
  if (want("drawer")) {
    tasks.push(
      (async () => {
        let skips = supabase.from("drawer_skips").select("id, reason, skipped_by, asked_by, created_at").eq("business_id", businessId).gte("created_at", fromIso).lt("created_at", toIso).order("created_at", { ascending: false }).limit(AUDIT_LIMIT + 1);
        let counts = supabase.from("drawer_counts").select("id, kind, expected_cents, counted_cents, note, counted_by, counted_at").eq("business_id", businessId).gte("counted_at", fromIso).lt("counted_at", toIso).order("counted_at", { ascending: false }).limit(AUDIT_LIMIT + 1);
        if (f.staffId) {
          skips = skips.eq("skipped_by", f.staffId);
          counts = counts.eq("counted_by", f.staffId);
        }
        const [s, c] = await Promise.all([skips, counts]);
        if (s.error) throw s.error;
        if (c.error) throw c.error;
        return [
          ...s.data.map(
            (k) =>
              ({
                id: k.id,
                at: k.created_at,
                type: "drawer",
                staffId: k.skipped_by,
                who: who(k.skipped_by),
                what: `Let cash be taken without the opening count${k.asked_by && k.asked_by !== k.skipped_by ? ` (asked by ${who(k.asked_by)})` : ""}: ${k.reason}`,
                href: "/sales/drawer",
              }) satisfies AuditRow,
          ),
          ...c.data
            .filter((d) => d.counted_cents !== d.expected_cents)
            .map((d) => {
              const diff = d.counted_cents - d.expected_cents;
              return {
                id: d.id,
                at: d.counted_at,
                type: "drawer",
                staffId: d.counted_by,
                who: who(d.counted_by),
                what: `${d.kind === "open" ? "Opening" : "Midday"} drawer count ${formatPrice(Math.abs(diff))} ${diff > 0 ? "over" : "short"}${d.note ? `: ${d.note}` : ""}`,
                href: "/sales/drawer",
              } satisfies AuditRow;
            }),
        ];
      })(),
    );
  }

  if (want("gift_cards")) {
    tasks.push(
      (async () => {
        let q = supabase
          .from("gift_card_events")
          .select("id, card_id, kind, amount_cents, reason, staff_id, created_at, card:gift_cards(code)")
          .eq("business_id", businessId)
          .in("kind", ["issued", "adjusted", "voided", "refunded", "reloaded"])
          .gte("created_at", fromIso)
          .lt("created_at", toIso)
          .order("created_at", { ascending: false })
          .limit(AUDIT_LIMIT + 1);
        if (f.staffId) q = q.eq("staff_id", f.staffId);
        const { data, error } = await q;
        if (error) throw error;
        const verb: Record<string, string> = { issued: "Promotional card issued", adjusted: "Balance adjusted", voided: "Card voided", refunded: "Refunded to card", reloaded: "Card reloaded" };
        return data.map((e) => {
          const code = e.card?.code ? ` …${e.card.code.slice(-4)}` : "";
          const amount = e.kind === "voided" ? "" : ` ${e.amount_cents >= 0 ? "+" : "−"}${formatPrice(Math.abs(e.amount_cents))}`;
          return { id: e.id, at: e.created_at, type: "gift_cards", staffId: e.staff_id, who: who(e.staff_id), what: `${verb[e.kind] ?? e.kind}${code}${amount}${e.reason ? `: ${e.reason}` : ""}`, href: `/gift-cards/${e.card_id}` } satisfies AuditRow;
        });
      })(),
    );
  }

  if (want("fees")) {
    tasks.push(
      (async () => {
        let q = supabase
          .from("policy_fee_events")
          .select("id, kind, amount_cents, detail, staff_id, created_at, fee:policy_fees(kind, appointment_id, client:clients(first_name, last_name))")
          .eq("business_id", businessId)
          .in("kind", ["waived", "refunded", "voided", "charged", "failed"])
          .gte("created_at", fromIso)
          .lt("created_at", toIso)
          .order("created_at", { ascending: false })
          .limit(AUDIT_LIMIT + 1);
        if (f.staffId) q = q.eq("staff_id", f.staffId);
        const { data, error } = await q;
        if (error) throw error;
        const verb: Record<string, string> = { waived: "waived", refunded: "refunded", voided: "voided (undone)", charged: "charged", failed: "didn't go through" };
        return data.map((e) => {
          const kind = e.fee?.kind === "no_show" ? "No-show fee" : "Late-cancel fee";
          const amount = e.amount_cents ? ` ${formatPrice(Math.abs(e.amount_cents))}` : "";
          return { id: e.id, at: e.created_at, type: "fees", staffId: e.staff_id, who: who(e.staff_id), what: `${kind}${amount} for ${client(e.fee?.client ?? null)} ${verb[e.kind] ?? e.kind}${e.detail ? `: ${e.detail}` : ""}`, href: e.fee?.appointment_id ? `/calendar?open=${e.fee.appointment_id}` : null } satisfies AuditRow;
        });
      })(),
    );
  }

  if (want("points")) {
    tasks.push(
      (async () => {
        let q = supabase
          .from("reward_points")
          .select("id, client_id, delta, reason, staff_id, created_at, client:clients(first_name, last_name)")
          .eq("business_id", businessId)
          .eq("kind", "adjust")
          .gte("created_at", fromIso)
          .lt("created_at", toIso)
          .order("created_at", { ascending: false })
          .limit(AUDIT_LIMIT + 1);
        if (f.staffId) q = q.eq("staff_id", f.staffId);
        const { data, error } = await q;
        if (error) throw error;
        return data.map(
          (e) =>
            ({ id: e.id, at: e.created_at, type: "points", staffId: e.staff_id, who: who(e.staff_id), what: `${e.delta > 0 ? "+" : "−"}${Math.abs(e.delta).toLocaleString("en-US")} points for ${client(e.client)}${e.reason ? `: ${e.reason}` : ""}`, href: `/clients/${e.client_id}` }) satisfies AuditRow,
        );
      })(),
    );
  }

  if (want("pay")) {
    tasks.push(
      (async () => {
        let q = supabase
          .from("staff_compensation_history")
          .select("id, staff_id, effective_from, service_commission_pct, retail_commission_pct, hourly_rate_cents, plan_id, changed_by, created_at")
          .eq("business_id", businessId)
          .gte("created_at", fromIso)
          .lt("created_at", toIso)
          .order("created_at", { ascending: false })
          .limit(AUDIT_LIMIT + 1);
        if (f.staffId) q = q.eq("changed_by", f.staffId);
        const { data, error } = await q;
        if (error) throw error;
        return data.map((e) => {
          const parts = [
            `${Number(e.service_commission_pct)}% services`,
            `${Number(e.retail_commission_pct)}% retail`,
            e.hourly_rate_cents ? `${formatPrice(e.hourly_rate_cents)}/hr` : null,
            e.plan_id ? "on a commission plan" : null,
          ].filter(Boolean);
          return { id: e.id, at: e.created_at, type: "pay", staffId: e.changed_by, who: who(e.changed_by), what: `Pay rates for ${staffName(e.staff_id) ?? "a former team member"}: ${parts.join(", ")}, from ${formatDay(e.effective_from)}`, href: `/payroll` } satisfies AuditRow;
        });
      })(),
    );
  }

  if (want("settings")) {
    tasks.push(
      (async () => {
        let live = supabase.from("go_live_events").select("id, kind, turned_on, staff_id, created_at").eq("business_id", businessId).gte("created_at", fromIso).lt("created_at", toIso).order("created_at", { ascending: false }).limit(AUDIT_LIMIT + 1);
        let exports = supabase.from("data_exports").select("id, staff_id, created_at").eq("business_id", businessId).gte("created_at", fromIso).lt("created_at", toIso).order("created_at", { ascending: false }).limit(AUDIT_LIMIT + 1);
        if (f.staffId) {
          live = live.eq("staff_id", f.staffId);
          exports = exports.eq("staff_id", f.staffId);
        }
        const [l, x] = await Promise.all([live, exports]);
        if (l.error) throw l.error;
        if (x.error) throw x.error;
        return [
          ...l.data.map((e) => ({ id: e.id, at: e.created_at, type: "settings", staffId: e.staff_id, who: who(e.staff_id), what: `${e.kind === "payments" ? "Real card payments" : "Texts and email to clients"} turned ${e.turned_on ? "on" : "off"}`, href: e.kind === "payments" ? "/settings/payments" : "/settings/messages" }) satisfies AuditRow),
          ...x.data.map((e) => ({ id: e.id, at: e.created_at, type: "settings", staffId: e.staff_id, who: who(e.staff_id), what: "Downloaded the salon's data", href: "/settings/data" }) satisfies AuditRow),
        ];
      })(),
    );
  }

  return mergeAudit(await Promise.all(tasks));
}
