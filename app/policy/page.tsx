import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AppShell, LoadingShell, NotLinked } from "@/components/app-shell";
import { FeeControls } from "@/components/policy-controls";
import { Card, EmptyState, PageHeader, pillClass } from "@/components/ui/page";
import { getCurrentStaff } from "@/lib/auth";
import { FEE_KIND_LABELS, type FeeStatus } from "@/lib/policy";
import { loadPolicy } from "@/lib/policy-load";
import { cardShare, policySummary, repeatOffenders, type ReportFee } from "@/lib/policy-report";
import { formatDay } from "@/lib/schedule-format";
import { addDays, fromLocal, toLocal, todayIn } from "@/lib/scheduling/time";
import { formatPrice } from "@/lib/services";
import { ChargeNowButton } from "./charge-now";

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

function Stat({ label, value, note, testId }: { label: string; value: string; note?: string; testId?: string }) {
  return (
    <div>
      <dt className="text-sm text-ink-muted">{label}</dt>
      <dd className="font-serif text-3xl font-semibold text-navy-900 tabular-nums" data-testid={testId}>
        {value}
      </dd>
      {note && <p className="text-xs text-ink-muted">{note}</p>}
    </div>
  );
}

// Owners and managers: the month's late cancellations and no-shows, what
// was charged, waived and failed, what the policy recovered, repeat
// offenders, and how many upcoming bookings have a card on file.
async function Policy({ searchParams }: Pick<PageProps<"/policy">, "searchParams">) {
  const [params, { supabase, staff: me }] = await Promise.all([searchParams, getCurrentStaff()]);
  if (!me) return <NotLinked />;
  if (me.role !== "owner" && me.role !== "manager") redirect("/dashboard");
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

  return (
    <AppShell section="policy" me={me}>
      <PageHeader
        title="Cancellation policy"
        description="Late cancellations and no-shows, and what the policy charged for them. Fees are charged to the card on file 10 minutes after; waive one with a reason, before or after."
        actions={
          me.role === "owner" ? (
            <div className="flex flex-wrap gap-2">
              <ChargeNowButton />
              <Link href="/settings/policies" className={pillClass(false)}>
                Policy settings
              </Link>
            </div>
          ) : undefined
        }
      />
      <nav aria-label="Month" className="mb-6 flex flex-wrap items-center gap-2">
        <Link href={`/policy?month=${shiftMonth(month, -1)}`} className={pillClass(false)}>
          Previous
        </Link>
        <span className="px-2 font-semibold" data-testid="policy-month">
          {monthLabel(month)}
        </span>
        {month < today.slice(0, 7) && (
          <Link href={`/policy?month=${shiftMonth(month, 1)}`} className={pillClass(false)}>
            Next
          </Link>
        )}
      </nav>

      <Card>
        <dl className="grid grid-cols-2 gap-6 lg:grid-cols-5">
          <Stat label="Recovered" value={formatPrice(summary.recoveredCents)} note="Fees charged, deposits kept included" testId="policy-recovered" />
          <Stat label="Charged" value={String(summary.charged.count)} note={formatPrice(summary.charged.cents)} testId="policy-charged" />
          <Stat label="Waived" value={String(summary.waived.count)} note={formatPrice(summary.waived.cents)} testId="policy-waived" />
          <Stat label="Didn't go through" value={String(summary.failed.count)} note={formatPrice(summary.failed.cents)} testId="policy-failed" />
          <Stat label="Card on file" value={`${share.percent}%`} note={`${share.withCard} of ${share.total} bookings in the next 30 days`} testId="policy-card-share" />
        </dl>
        <p className="mt-4 text-sm text-ink-muted">
          {summary.lateCancels} late cancellation{summary.lateCancels === 1 ? "" : "s"} and {summary.noShows} no-show{summary.noShows === 1 ? "" : "s"} in {monthLabel(month)}
          {summary.waiting.count ? `; ${summary.waiting.count} waiting to be charged (${formatPrice(summary.waiting.cents)})` : ""}.
        </p>
      </Card>

      <Card title="Late cancellations and no-shows" flush>
        {monthFees.data!.length === 0 ? (
          <div className="p-5">
            <EmptyState>None in {monthLabel(month)}.</EmptyState>
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {monthFees.data!.map((f) => (
              <li key={f.id} className="grid gap-2 px-5 py-3.5 sm:grid-cols-[10rem_1fr]" data-testid="policy-row">
                <div>
                  <Link href={`/clients/${f.client_id}`} className="font-medium text-link underline-offset-2 hover:underline">
                    {f.client.first_name} {f.client.last_name}
                  </Link>
                  <p className="text-sm text-ink-muted">
                    {FEE_KIND_LABELS[f.kind as "late_cancel" | "no_show"]} · {dayOf(f.appointment.starts_at)}
                  </p>
                </div>
                <FeeControls
                  fee={{ id: f.id, kind: f.kind as "late_cancel" | "no_show", feeCents: f.fee_cents, fromDepositCents: f.from_deposit_cents, status: f.status as FeeStatus, cardLabel: f.card_label, failureReason: f.failure_reason, waiveReason: f.waive_reason }}
                  canWaive={canWaive}
                  canRetry
                />
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card
        title="Repeat offenders"
        description={`${policy.settings.repeatCount} or more late cancellations or no-shows in the last ${policy.settings.repeatMonths} months (waived ones don't count)${policy.settings.repeatAction === "off" ? "." : policy.settings.repeatAction === "prepay" ? ": they pay for the whole visit up front." : `: they pay a ${policy.settings.repeatDepositPercent}% deposit.`}`}
        flush
      >
        {offenders.length === 0 ? (
          <div className="p-5">
            <EmptyState>No repeat offenders.</EmptyState>
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {offenders.map((o) => (
              <li key={o.clientId} className="flex items-center justify-between gap-3 px-5 py-3" data-testid="offender">
                <Link href={`/clients/${o.clientId}`} className="font-medium text-link underline-offset-2 hover:underline">
                  {o.clientName}
                </Link>
                <span className="text-sm text-ink-muted tabular-nums">
                  {o.strikes} · last {dayOf(o.lastAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </AppShell>
  );
}
