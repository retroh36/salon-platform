import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AppShell, LoadingShell, NotLinked } from "@/components/app-shell";
import { buttonClass } from "@/components/ui/button";
import { ChevronLeftIcon, ChevronRightIcon } from "@/components/ui/icons";
import { EmptyState, PageHeader, Section, nameLinkClass } from "@/components/ui/page";
import { TableCard, numClass, tableClass, tdClass, thClass, theadClass, trClass } from "@/components/ui/table";
import { getCurrentStaff } from "@/lib/auth";
import { type FeeStatus } from "@/lib/policy";
import { loadPolicy } from "@/lib/policy-load";
import { cardShare, policySummary, repeatOffenders, type ReportFee } from "@/lib/policy-report";
import { formatDay } from "@/lib/schedule-format";
import { addDays, fromLocal, toLocal, todayIn } from "@/lib/scheduling/time";
import { ChargeNowButton } from "./charge-now";
import { FeeRow } from "./fee-row";
import { cents } from "./money";
import { can } from "@/lib/permissions";

export const metadata: Metadata = { title: "Policy" };

export default function PolicyPage({ searchParams }: PageProps<"/policy">) {
  return (
    <Suspense fallback={<LoadingShell />}>
      <Policy searchParams={searchParams} />
    </Suspense>
  );
}

const monthLabel = (month: string) => new Date(`${month}-15T12:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
const shiftMonth = (month: string, by: number) => {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};

// One cell of the stat strip: label, value, note.
function Stat({ label, value, note, testId, title }: { label: string; value: string; note?: string; testId?: string; title?: string }) {
  return (
    <div className="flex flex-col gap-1 bg-surface px-4 py-3 max-lg:last:col-span-2" title={title}>
      <dt className="text-13 text-ink-muted">{label}</dt>
      <dd className="text-2xl font-semibold tracking-[-0.015em] text-ink tabular-nums" data-testid={testId}>
        {value}
      </dd>
      {note && <dd className="text-xs text-ink-subtle tabular-nums">{note}</dd>}
    </div>
  );
}

// Owners and managers: the month's late cancellations and no-shows, what
// was charged, waived and failed, what the policy recovered, repeat
// offenders, and how many upcoming bookings have a card on file.
async function Policy({ searchParams }: Pick<PageProps<"/policy">, "searchParams">) {
  const [params, { supabase, staff: me }] = await Promise.all([searchParams, getCurrentStaff()]);
  if (!me) return <NotLinked />;
  if (!can(me, "reports")) redirect("/dashboard");
  const tz = me.location.timezone;
  const today = todayIn(tz);
  const month = typeof params.month === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(params.month) ? params.month : today.slice(0, 7);
  const from = fromLocal(`${month}-01`, 0, tz)!;
  const to = fromLocal(`${shiftMonth(month, 1)}-01`, 0, tz)!;

  const policy = await loadPolicy(supabase, me.business_id);
  const since = new Date();
  since.setUTCMonth(since.getUTCMonth() - policy.settings.repeatMonths);
  const upcomingEnd = fromLocal(addDays(today, 30), 0, tz)!;
  const select = "id, kind, fee_cents, from_deposit_cents, status, card_label, failure_reason, waive_reason, created_at, client_id, client:clients(first_name, last_name), appointment:appointments(starts_at)";
  const [monthFees, recentFees, upcoming, cards] = await Promise.all([
    supabase.from("policy_fees").select(select).eq("business_id", me.business_id).gte("created_at", from.toISOString()).lt("created_at", to.toISOString()).order("created_at", { ascending: false }),
    supabase.from("policy_fees").select("id, kind, fee_cents, from_deposit_cents, status, created_at, client_id, client:clients(first_name, last_name)").eq("business_id", me.business_id).gte("created_at", since.toISOString()),
    supabase.from("appointments").select("client_id").eq("location_id", me.location.id).in("status", ["booked", "confirmed"]).gte("starts_at", new Date().toISOString()).lt("starts_at", upcomingEnd.toISOString()),
    supabase.from("client_cards").select("client_id").eq("business_id", me.business_id).is("removed_at", null),
  ]);
  for (const r of [monthFees, recentFees, upcoming, cards]) if (r.error) throw r.error;
  const asReport = (f: { id: string; kind: string; fee_cents: number; from_deposit_cents: number; status: string; created_at: string; client_id: string; client: { first_name: string; last_name: string } }): ReportFee => ({
    id: f.id,
    kind: f.kind as ReportFee["kind"],
    feeCents: f.fee_cents,
    fromDepositCents: f.from_deposit_cents,
    status: f.status,
    createdAt: f.created_at,
    clientId: f.client_id,
    clientName: `${f.client.first_name} ${f.client.last_name}`.trim(),
  });
  const summary = policySummary(monthFees.data!.map(asReport));
  const offenders = repeatOffenders(recentFees.data!.map(asReport), policy.settings.repeatCount);
  const share = cardShare(upcoming.data!.map((a) => ({ clientId: a.client_id })), new Set(cards.data!.map((c) => c.client_id)));
  const dayOf = (iso: string) => formatDay(toLocal(new Date(iso), tz).date);
  const canWaive = policy.waiveRoles.includes(me.role);

  const lastMonth = month >= today.slice(0, 7);
  const repeatRule = `${policy.settings.repeatCount} or more late cancellations or no-shows in the last ${policy.settings.repeatMonths} months (waived ones don't count)${policy.settings.repeatAction === "off" ? "." : policy.settings.repeatAction === "prepay" ? ": they pay for the whole visit up front." : `: they pay a ${policy.settings.repeatDepositPercent}% deposit.`}`;

  return (
    <AppShell section="policy" me={me}>
      <PageHeader
        title="Cancellation policy"
        description="Late cancellations and no-shows, and what the policy charged for them."
        actions={
          can(me, "settings") ? (
            <>
              <Link href="/settings/policies" className={buttonClass("secondary")}>
                Policy settings
              </Link>
              <ChargeNowButton />
            </>
          ) : undefined
        }
      />
      <nav aria-label="Month" className="mb-4 flex items-center gap-2">
        <Link href={`/policy?month=${shiftMonth(month, -1)}`} aria-label="Previous month" title="Previous month" className={buttonClass("secondary", "xs", "", { square: true })}>
          <ChevronLeftIcon className="size-4" />
        </Link>
        <span className="min-w-32 text-center text-sm font-semibold text-ink" data-testid="policy-month">
          {monthLabel(month)}
        </span>
        {lastMonth ? (
          <span aria-hidden className={buttonClass("secondary", "xs", "pointer-events-none opacity-40", { square: true })}>
            <ChevronRightIcon className="size-4" />
          </span>
        ) : (
          <Link href={`/policy?month=${shiftMonth(month, 1)}`} aria-label="Next month" title="Next month" className={buttonClass("secondary", "xs", "", { square: true })}>
            <ChevronRightIcon className="size-4" />
          </Link>
        )}
      </nav>

      <dl className="grid grid-cols-2 divide-line overflow-hidden rounded-lg border border-line bg-surface max-lg:gap-px max-lg:bg-line lg:grid-cols-5 lg:divide-x">
        <Stat label="Recovered" value={cents(summary.recoveredCents)} note="Fees + kept deposits" testId="policy-recovered" />
        <Stat label="Charged" value={String(summary.charged.count)} note={cents(summary.charged.cents)} testId="policy-charged" />
        <Stat label="Waived" value={String(summary.waived.count)} note={cents(summary.waived.cents)} testId="policy-waived" />
        <Stat label="Didn't go through" value={String(summary.failed.count)} note={cents(summary.failed.cents)} testId="policy-failed" />
        <Stat label="Card on file" value={`${share.percent}%`} note={`${share.withCard} of ${share.total} upcoming`} testId="policy-card-share" title="Bookings in the next 30 days whose client has a card saved" />
      </dl>
      <p className="mt-3 mb-8 text-13 text-ink-muted">
        {summary.lateCancels} late cancellation{summary.lateCancels === 1 ? "" : "s"} and {summary.noShows} no-show{summary.noShows === 1 ? "" : "s"} this month
        {summary.waiting.count ? ` · ${summary.waiting.count} fee${summary.waiting.count === 1 ? "" : "s"} waiting to be charged (${cents(summary.waiting.cents)})` : ""}
      </p>

      <Section title="Late cancellations and no-shows" titleId="fees" count={monthFees.data!.length} description="Fees are charged to the card on file 10 minutes after. Waive one with a reason, before or after.">
        {monthFees.data!.length === 0 ? (
          <TableCard>
            <EmptyState art={false}>None in {monthLabel(month)}.</EmptyState>
          </TableCard>
        ) : (
          <TableCard>
            <table className={tableClass} aria-labelledby="fees">
              <thead className={theadClass}>
                <tr>
                  <th className={thClass}>Client</th>
                  <th className={thClass}>Date</th>
                  <th className={thClass}>Type</th>
                  <th className={`${thClass} text-right`}>Fee</th>
                  <th className={thClass}>Status</th>
                  <th className={thClass}>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {monthFees.data!.map((f) => (
                  <FeeRow
                    key={f.id}
                    canWaive={canWaive}
                    fee={{
                      id: f.id,
                      clientId: f.client_id,
                      clientName: `${f.client.first_name} ${f.client.last_name}`.trim(),
                      day: dayOf(f.appointment.starts_at),
                      kind: f.kind as "late_cancel" | "no_show",
                      feeCents: f.fee_cents,
                      fromDepositCents: f.from_deposit_cents,
                      status: f.status as FeeStatus,
                      cardLabel: f.card_label,
                      failureReason: f.failure_reason,
                      waiveReason: f.waive_reason,
                    }}
                  />
                ))}
              </tbody>
            </table>
          </TableCard>
        )}
      </Section>

      <Section title="Repeat offenders" titleId="offenders" description={repeatRule} count={offenders.length}>
        <TableCard>
          {offenders.length === 0 ? (
            <EmptyState art={false}>No repeat offenders.</EmptyState>
          ) : (
            <table className={tableClass} aria-labelledby="offenders">
              <thead className={theadClass}>
                <tr>
                  <th className={thClass}>Client</th>
                  <th className={`${thClass} text-right`}>Late cancels and no-shows</th>
                  <th className={thClass}>Last</th>
                </tr>
              </thead>
              <tbody>
                {offenders.map((o) => (
                  <tr key={o.clientId} className={trClass} data-testid="offender">
                    <td className={tdClass}>
                      <Link href={`/clients/${o.clientId}`} className={nameLinkClass}>
                        {o.clientName}
                      </Link>
                    </td>
                    <td className={`${tdClass} ${numClass}`}>{o.strikes}</td>
                    <td className={`${tdClass} whitespace-nowrap text-ink-muted`}>{dayOf(o.lastAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </TableCard>
      </Section>
    </AppShell>
  );
}
