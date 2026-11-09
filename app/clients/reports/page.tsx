import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AppShell, LoadingShell, NotLinked } from "@/components/app-shell";
import { BackLink } from "@/components/ui/back-link";
import { buttonClass } from "@/components/ui/button";
import { Alert, Badge, EmptyState, nameLinkClass, Section } from "@/components/ui/page";
import { PageHeader } from "@/components/ui/page";
import { numClass, TableCard, tableClass, tdClass, thClass, theadClass, trClass } from "@/components/ui/table";
import { getCurrentStaff } from "@/lib/auth";
import { decodeReport, describeReport, EMPTY_REPORT, encodeReport, readReport, REPORT_LIMIT, reportProblem, type ClientReport } from "@/lib/client-reports";
import { knownOf, loadReportMenu, namesOf, runClientReport } from "@/lib/client-reports-load";
import { formatDate } from "@/lib/clients";
import { can } from "@/lib/permissions";
import { todayIn } from "@/lib/scheduling/time";
import { formatPrice } from "@/lib/services";
import { isFrontOfHouse } from "@/lib/staff";
import { ReportForm } from "./report-form";
import { RemoveReport, SaveReport } from "./saved";

export const metadata: Metadata = { title: "Client reports" };

export default function ClientReportsPage({ searchParams }: PageProps<"/clients/reports">) {
  return (
    <Suspense fallback={<LoadingShell />}>
      <ClientReports searchParams={searchParams} />
    </Suspense>
  );
}

// Lists of clients by what they had, with whom and when, the same columns
// every time: set by hand, built by Denise from a question (her link opens
// it here with ?r=), or saved and run again (?saved=).
async function ClientReports({ searchParams }: Pick<PageProps<"/clients/reports">, "searchParams">) {
  const [params, { supabase, staff: me }] = await Promise.all([searchParams, getCurrentStaff()]);
  if (!me) return <NotLinked />;
  const tz = me.location.timezone;
  const today = todayIn(tz);
  const spend = isFrontOfHouse(me.role);
  const [menu, saved] = await Promise.all([
    loadReportMenu(supabase, me.business_id),
    supabase.from("saved_reports").select("id, name, definition, shared, staff_id, staff:staff(first_name)").eq("business_id", me.business_id).order("name"),
  ]);
  if (saved.error) throw saved.error;
  const known = knownOf(menu);
  const names = namesOf(menu);

  const savedId = typeof params.saved === "string" ? params.saved : null;
  const open = savedId ? saved.data.find((s) => s.id === savedId) : undefined;
  const raw = open ? open.definition : typeof params.r === "string" ? decodeReport(params.r) : null;
  const read = raw ? readReport(raw, known) : null;
  const report: ClientReport | null = read?.report ?? null;
  const problem = report ? reportProblem(report, today) : null;
  const result = report && !problem ? await runClientReport(supabase, { businessId: me.business_id, timezone: tz, today }, report, { spend, limit: REPORT_LIMIT }) : null;
  const encoded = report ? encodeReport(report) : "";
  const mayRemove = (s: (typeof saved.data)[number]) => s.staff_id === me.id || (s.shared && can(me, "reports"));

  return (
    <AppShell section="clients" me={me}>
      <BackLink href="/clients">Clients</BackLink>
      <PageHeader
        title={open ? open.name : "Client reports"}
        description={
          spend
            ? "Lists of clients by what they had, with whom and when, their last and next visit and spend. The same columns every time, to save and run again."
            : "Lists of your clients by what they had and when, and their last and next visit. The same columns every time, to save and run again."
        }
      />

      {savedId && !open && <Alert className="mb-4">{"That saved report isn't there any more, or isn't shared with you."}</Alert>}
      <ReportForm key={encoded || "new"} initial={report ?? EMPTY_REPORT} menu={menu} today={today} stylists={spend} spend={spend} />

      {report && (
        <Section
          title="Results"
          titleId="results-heading"
          count={result?.total}
          description={describeReport(report, names)}
          actions={
            result &&
            result.total > 0 && (
              <>
                {!open && <SaveReport encoded={encoded} canShare={can(me, "reports")} suggested="" />}
                {can(me, "settings") && (
                  <Link href={`/campaigns/new?r=${encoded}`} className={buttonClass("secondary")}>
                    Send a campaign
                  </Link>
                )}
                {can(me, "export_data") && (
                  <form method="post" action="/clients/reports/export">
                    <input type="hidden" name="r" value={encoded} />
                    <button type="submit" className={buttonClass("secondary")}>
                      Export CSV
                    </button>
                  </form>
                )}
              </>
            )
          }
        >
          {read && read.dropped.length > 0 && <Alert tone="info" className="mb-3">{`Left out, since it's no longer on the menu or the team: ${read.dropped.join(", ")}.`}</Alert>}
          {problem ? (
            <Alert>{problem}</Alert>
          ) : !result || result.total === 0 ? (
            <EmptyState title="No clients match">Try fewer filters, or a longer stretch of time.</EmptyState>
          ) : (
            <>
              {result.total > result.rows.length && <p className="mb-3 text-13 text-ink-muted">{`Showing the first ${result.rows.length}.`}</p>}
              <TableCard>
                <table className={tableClass} aria-label="Report">
                  <thead className={theadClass}>
                    <tr>
                      <th scope="col" className={thClass}>Name</th>
                      <th scope="col" className={`${thClass} hidden md:table-cell`}>Phone</th>
                      <th scope="col" className={`${thClass} ${numClass}`}>Visits counted</th>
                      <th scope="col" className={`${thClass} hidden sm:table-cell`}>Last visit</th>
                      <th scope="col" className={`${thClass} hidden sm:table-cell`}>Next visit</th>
                      <th scope="col" className={`${thClass} hidden lg:table-cell`}>Usual stylist</th>
                      {spend && <th scope="col" className={`${thClass} ${numClass} hidden sm:table-cell`}>Spend</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {result.rows.map((c) => (
                      <tr key={c.id} className={trClass}>
                        <td className={tdClass}>
                          <Link href={`/clients/${c.id}`} className={nameLinkClass}>
                            {c.firstName} {c.lastName}
                          </Link>
                        </td>
                        <td className={`${tdClass} hidden whitespace-nowrap text-ink-muted md:table-cell`}>{c.phone ?? "—"}</td>
                        <td className={`${tdClass} ${numClass}`}>{c.visits}</td>
                        <td className={`${tdClass} hidden whitespace-nowrap sm:table-cell`}>{c.lastVisit ? formatDate(c.lastVisit) : "—"}</td>
                        <td className={`${tdClass} hidden whitespace-nowrap sm:table-cell`}>{c.nextVisit ? formatDate(c.nextVisit) : "—"}</td>
                        <td className={`${tdClass} hidden text-ink-muted lg:table-cell`}>{c.usualStylist ?? "—"}</td>
                        {spend && <td className={`${tdClass} ${numClass} hidden sm:table-cell`}>{c.spendCents === null ? "—" : formatPrice(c.spendCents)}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableCard>
            </>
          )}
        </Section>
      )}

      <Section title="Saved reports" titleId="saved-heading" count={saved.data.length}>
        {saved.data.length === 0 ? (
          <p className="text-sm text-ink-muted">None yet. Run a report, then Save report to keep it here.</p>
        ) : (
          <TableCard>
            <table className={tableClass} aria-label="Saved reports">
              <thead className={theadClass}>
                <tr>
                  <th scope="col" className={thClass}>Name</th>
                  <th scope="col" className={`${thClass} hidden md:table-cell`}>Lists</th>
                  <th scope="col" className={thClass}>
                    <span className="sr-only">Shared</span>
                  </th>
                  <th scope="col" className={thClass}>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {saved.data.map((s) => (
                  <tr key={s.id} className={trClass}>
                    <td className={tdClass}>
                      <Link href={`/clients/reports?saved=${s.id}`} className={nameLinkClass}>
                        {s.name}
                      </Link>
                    </td>
                    <td className={`${tdClass} hidden text-ink-muted md:table-cell`}>{describeReport(readReport(s.definition, known).report, names)}</td>
                    <td className={tdClass}>{s.shared && <Badge tone="info">{s.staff_id === me.id ? "Shared" : `Shared by ${s.staff?.first_name ?? "a team member"}`}</Badge>}</td>
                    <td className={`${tdClass} text-right`}>{mayRemove(s) && <RemoveReport id={s.id} name={s.name} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableCard>
        )}
      </Section>
    </AppShell>
  );
}
