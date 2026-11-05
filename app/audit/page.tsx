import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AppShell, LoadingShell, NotLinked } from "@/components/app-shell";
import { buttonClass } from "@/components/ui/button";
import { fieldClass, labelClass, selectClass } from "@/components/ui/field";
import { EmptyState, PageHeader, nameLinkClass } from "@/components/ui/page";
import { TableCard, tableClass, tdClass, thClass, theadClass, trClass } from "@/components/ui/table";
import { AUDIT_LIMIT, AUDIT_TYPES, parseAuditFilters } from "@/lib/audit";
import { loadAudit } from "@/lib/audit-load";
import { getCurrentStaff } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { formatDay } from "@/lib/schedule-format";
import { formatMinute, toLocal, todayIn } from "@/lib/scheduling/time";
import { fullName } from "@/lib/staff";

export const metadata: Metadata = { title: "Audit trail" };

export default function AuditPage({ searchParams }: PageProps<"/audit">) {
  return (
    <Suspense fallback={<LoadingShell />}>
      <Audit searchParams={searchParams} />
    </Suspense>
  );
}

// Who changed what (the `audit` permission: owners, managers by default):
// every visit change, sale, void, refund, discount, gift card and fee
// change, points adjustment, pay rate and going live, newest first, by
// type, person and dates. Read-only: the logs are written by the database.
async function Audit({ searchParams }: Pick<PageProps<"/audit">, "searchParams">) {
  const [params, { supabase, staff: me }] = await Promise.all([searchParams, getCurrentStaff()]);
  if (!me) return <NotLinked />;
  if (!can(me, "audit")) redirect("/dashboard");
  const tz = me.location.timezone;
  const filters = parseAuditFilters(params, todayIn(tz));
  const [{ rows, more }, team] = await Promise.all([
    loadAudit(supabase, me.business_id, tz, filters),
    supabase.from("staff").select("id, first_name, last_name, is_active").eq("business_id", me.business_id).order("first_name"),
  ]);
  if (team.error) throw team.error;
  const when = (iso: string) => {
    const local = toLocal(new Date(iso), tz);
    return `${formatDay(local.date)}, ${formatMinute(local.minute)}`;
  };
  return (
    <AppShell section="audit" me={me}>
      <PageHeader title="Audit trail" description="Who changed what: visits, sales, voids, refunds, discounts, gift cards, fees, points and pay rates. Nothing here can be edited or deleted." />
      <form method="get" action="/audit" className="mb-6 flex flex-wrap items-end gap-3" aria-label="Filter the audit trail">
        <label className={`${labelClass} min-w-48 flex-1 basis-48`}>
          What
          <select name="type" defaultValue={filters.type ?? ""} className={selectClass}>
            <option value="">Everything</option>
            {AUDIT_TYPES.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <label className={`${labelClass} min-w-48 flex-1 basis-48`}>
          Who
          <select name="staff" defaultValue={filters.staffId ?? ""} className={selectClass}>
            <option value="">Everyone</option>
            {team.data.map((s) => (
              <option key={s.id} value={s.id}>
                {fullName(s)}
                {s.is_active ? "" : " (former)"}
              </option>
            ))}
          </select>
        </label>
        <label className={`${labelClass} basis-40`}>
          From
          <input type="date" name="from" defaultValue={filters.from} className={fieldClass} />
        </label>
        <label className={`${labelClass} basis-40`}>
          To
          <input type="date" name="to" defaultValue={filters.to} className={fieldClass} />
        </label>
        <button type="submit" className={buttonClass("primary")}>
          Show
        </button>
      </form>
      {rows.length === 0 ? (
        <EmptyState title="Nothing in these dates">Try another person, type or wider dates.</EmptyState>
      ) : (
        <TableCard>
          <table className={tableClass} data-testid="audit-table">
            <thead className={theadClass}>
              <tr>
                <th className={thClass}>When</th>
                <th className={thClass}>Who</th>
                <th className={thClass}>What</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.type}:${r.id}`} className={trClass} data-type={r.type}>
                  <td className={`${tdClass} whitespace-nowrap text-ink-muted tabular-nums`}>{when(r.at)}</td>
                  <td className={`${tdClass} whitespace-nowrap text-ink`}>{r.who}</td>
                  <td className={`${tdClass} min-w-72 text-ink`}>
                    {r.href ? (
                      <Link href={r.href} className={nameLinkClass}>
                        {r.what}
                      </Link>
                    ) : (
                      r.what
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableCard>
      )}
      {more && <p className="mt-3 text-13 text-ink-muted">Showing the latest {AUDIT_LIMIT}. Choose a person, a type or fewer days to see the rest.</p>}
    </AppShell>
  );
}
