import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AppShell, LoadingShell, NotLinked } from "@/components/app-shell";
import { buttonClass } from "@/components/ui/button";
import { Badge, Card, EmptyState, PageHeader, nameLinkClass, textLinkClass } from "@/components/ui/page";
import { TableCard, numClass, tableClass, tdClass, thClass, theadClass, trClass } from "@/components/ui/table";
import { canManage, getCurrentStaff } from "@/lib/auth";
import { isUuid } from "@/lib/ids";
import { can } from "@/lib/permissions";
import { ACCRUAL_LABELS, formatPto, type PtoLineKind } from "@/lib/pto";
import { loadBalances } from "@/lib/pto-load";
import { formatDay } from "@/lib/schedule-format";
import { todayIn } from "@/lib/scheduling/time";
import { fullName } from "@/lib/staff";
import { countPendingRequests } from "@/lib/time-off-requests-load";
import { SchedulingTabs } from "../scheduling-tabs";
import { AdjustForm } from "./adjust-form";

export const metadata: Metadata = { title: "Time off balances" };

export default function BalancesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return (
    <Suspense fallback={<LoadingShell />}>
      <Balances searchParams={searchParams} />
    </Suspense>
  );
}

const KIND_LABELS: Record<PtoLineKind, string> = { granted: "Granted", earned: "Earned", used: "Used", lost: "Didn't carry over", adjusted: "Adjusted" };

// Everyone's PTO: earned and used this PTO year, the balance, what's
// booked and waiting, and what's left to ask for; then time off taken this
// year by type. A name opens their statement, where those who manage the
// team adjust it.
async function Balances({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me) return <NotLinked />;
  if (!canManage(me.role)) redirect("/time-off");
  const params = await searchParams;
  const staffId = typeof params.staff === "string" && isUuid(params.staff) ? params.staff : undefined;
  const today = todayIn(me.location.timezone);
  const [pto, pending] = await Promise.all([loadBalances(supabase, { businessId: me.business_id, location: me.location, today }), countPendingRequests(supabase, me.location, today)]);

  const header = (
    <>
      <PageHeader
        title="Scheduling"
        description="Time off balances: what each person has earned, used and has left."
        actions={
          pto && !staffId ? (
            <a href="/scheduling/balances/export" className={buttonClass("secondary", "md")}>
              Export CSV
            </a>
          ) : undefined
        }
      />
      <SchedulingTabs current="balances" pending={pending} />
    </>
  );

  if (!pto)
    return (
      <AppShell section="scheduling" me={me} wide denise="overlay">
        {header}
        <EmptyState
          title="PTO isn't tracked yet"
          action={
            can(me, "settings") ? (
              <Link href="/settings/time-off" className={buttonClass("primary", "md")}>
                Set up PTO
              </Link>
            ) : undefined
          }
        >
          Set how PTO is earned on Settings, Time off. Balances then show here.
        </EmptyState>
      </AppShell>
    );

  const { policy, types, people } = pto;
  const person = staffId ? people.find((p) => p.staffId === staffId) : undefined;
  const yearStart = people[0]?.statement.yearStart;
  const rule =
    policy.accrual === "yearly"
      ? `${formatPto(policy.yearlyMinutes)} a year`
      : policy.accrual === "per_hour"
        ? `${formatPto(policy.earnMinutes)} for every ${policy.perHours} hr worked`
        : `${formatPto(policy.periodMinutes)} each pay period`;
  const carry = policy.carryOver === "all" ? "everything carries over" : policy.carryOver === "none" ? "nothing carries over" : `up to ${formatPto(policy.carryMinutes)} carries over`;

  if (person) {
    const s = person.statement;
    return (
      <AppShell section="scheduling" me={me} wide denise="overlay">
        {header}
        <p className="mb-4 text-sm">
          <Link href="/scheduling/balances" className={textLinkClass}>
            All balances
          </Link>
        </p>
        <h2 className="mb-1 text-xl font-semibold text-ink">{fullName({ first_name: person.firstName, last_name: person.lastName })}</h2>
        <p className="mb-6 text-sm text-ink-muted">
          {formatPto(s.available)} left to ask for · {formatPto(s.balance)} balance today, {formatPto(s.booked)} booked, {formatPto(s.pending)} waiting · counted from {formatDay(person.startsOn, true)}
        </p>
        {can(me, "team") && (
          <Card title="Adjust the balance" titleId="adjust-heading" description="A starting balance, a correction, or hours paid out.">
            <AdjustForm staffId={person.staffId} firstName={person.firstName} today={today} />
          </Card>
        )}
        <h3 className="mb-3 text-base font-semibold text-ink">Statement</h3>
        {s.lines.length === 0 ? (
          <p className="text-sm text-ink-muted">Nothing yet.</p>
        ) : (
          <TableCard>
            <table className={tableClass} data-testid="pto-statement">
              <thead className={theadClass}>
                <tr>
                  <th className={thClass}>Date</th>
                  <th className={thClass}>What</th>
                  <th className={`${thClass} ${numClass}`}>Hours</th>
                  <th className={`${thClass} ${numClass}`}>Balance</th>
                </tr>
              </thead>
              <tbody>
                {[...s.lines].reverse().map((l, i) => (
                  <tr key={i} className={trClass}>
                    <td className={`${tdClass} whitespace-nowrap`}>{formatDay(l.date, true)}</td>
                    <td className={tdClass}>
                      <span className="font-medium text-ink">{KIND_LABELS[l.kind]}</span>
                      <span className="text-ink-muted"> · {l.note}</span>
                    </td>
                    <td className={`${tdClass} ${numClass}`}>{l.minutes > 0 ? `+${formatPto(l.minutes)}` : formatPto(l.minutes)}</td>
                    <td className={`${tdClass} ${numClass}`}>{formatPto(l.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableCard>
        )}
      </AppShell>
    );
  }

  return (
    <AppShell section="scheduling" me={me} wide denise="overlay">
      {header}
      <p className="mb-4 text-sm text-ink-muted" data-testid="pto-policy">
        {ACCRUAL_LABELS[policy.accrual]}: {rule}. The PTO year started {yearStart ? formatDay(yearStart, true) : ""}; at its end {carry}
        {policy.capMinutes != null ? `, and nobody holds more than ${formatPto(policy.capMinutes)}` : ""}.
      </p>
      <TableCard>
        <table className={tableClass} data-testid="pto-balances">
          <thead className={theadClass}>
            <tr>
              <th className={thClass}>Name</th>
              <th className={`${thClass} ${numClass}`}>Carried over</th>
              <th className={`${thClass} ${numClass}`}>Earned this year</th>
              <th className={`${thClass} ${numClass}`}>Used this year</th>
              <th className={`${thClass} ${numClass}`}>Balance</th>
              <th className={`${thClass} ${numClass}`}>Booked</th>
              <th className={`${thClass} ${numClass}`}>Waiting</th>
              <th className={`${thClass} ${numClass}`}>Left to ask for</th>
            </tr>
          </thead>
          <tbody>
            {people.map((p) => (
              <tr key={p.staffId} className={trClass} data-staff={p.staffId}>
                <td className={tdClass}>
                  <Link href={`/scheduling/balances?staff=${p.staffId}`} className={nameLinkClass}>
                    {fullName({ first_name: p.firstName, last_name: p.lastName })}
                  </Link>
                </td>
                <td className={`${tdClass} ${numClass}`}>{formatPto(p.statement.carriedIn)}</td>
                <td className={`${tdClass} ${numClass}`}>{formatPto(p.statement.earnedThisYear)}</td>
                <td className={`${tdClass} ${numClass}`}>{formatPto(p.statement.usedThisYear)}</td>
                <td className={`${tdClass} ${numClass}`}>{formatPto(p.statement.balance)}</td>
                <td className={`${tdClass} ${numClass}`}>{formatPto(p.statement.booked)}</td>
                <td className={`${tdClass} ${numClass}`}>{formatPto(p.statement.pending)}</td>
                <td className={`${tdClass} ${numClass} font-semibold`}>
                  {p.statement.available < 0 ? <Badge tone="danger">{formatPto(p.statement.available)}</Badge> : formatPto(p.statement.available)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableCard>

      <h2 className="mt-8 mb-1 text-base font-semibold text-ink">Time off taken this PTO year</h2>
      <p className="mb-3 text-13 text-ink-muted">Approved time off up to today, in each person&rsquo;s working hours, by type. Types that use PTO are marked.</p>
      <TableCard>
        <table className={tableClass} data-testid="time-off-taken">
          <thead className={theadClass}>
            <tr>
              <th className={thClass}>Name</th>
              {types.map((t) => (
                <th key={t.id} className={`${thClass} ${numClass}`}>
                  {t.name}
                  {t.usesPto ? " (PTO)" : ""}
                </th>
              ))}
              <th className={`${thClass} ${numClass}`}>Total</th>
            </tr>
          </thead>
          <tbody>
            {people.map((p) => (
              <tr key={p.staffId} className={trClass}>
                <td className={tdClass}>{fullName({ first_name: p.firstName, last_name: p.lastName })}</td>
                {types.map((t) => (
                  <td key={t.id} className={`${tdClass} ${numClass}`}>
                    {p.takenByType.get(t.id) ? formatPto(p.takenByType.get(t.id)!) : "–"}
                  </td>
                ))}
                <td className={`${tdClass} ${numClass} font-semibold`}>{formatPto([...p.takenByType.values()].reduce((n, m) => n + m, 0))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableCard>
    </AppShell>
  );
}
