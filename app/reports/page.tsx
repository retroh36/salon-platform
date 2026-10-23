import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AppShell, LoadingShell, NotLinked } from "@/components/app-shell";
import { Card, PageHeader, pillClass } from "@/components/ui/page";
import { getCurrentStaff } from "@/lib/auth";
import { METHOD_LABELS } from "@/lib/checkout";
import { loadCloseout, loadGiftCardActivity, loadGiftCardLiability, loadRebooking, loadUnusedPackages } from "@/lib/reports-load";
import { formatLongDay } from "@/lib/schedule-format";
import { addDays, isLocalDate, todayIn } from "@/lib/scheduling/time";
import { formatPrice } from "@/lib/services";
import { CloseoutForm } from "./closeout-form";

export const metadata: Metadata = { title: "Reports" };

const PERIODS = { this_month: "This month", last_month: "Last month", last_30_days: "Last 30 days" } as const;
type Period = keyof typeof PERIODS;

function rangeOf(period: Period, today: string): { from: string; to: string } {
  const [y, m] = today.split("-").map(Number);
  const first = (yy: number, mm: number) => `${yy}-${String(mm).padStart(2, "0")}-01`;
  if (period === "this_month") return { from: first(y, m), to: today };
  if (period === "last_month") {
    const [py, pm] = m === 1 ? [y - 1, 12] : [y, m - 1];
    return { from: first(py, pm), to: addDays(first(y, m), -1) };
  }
  return { from: addDays(today, -29), to: today };
}

export default function ReportsPage({ searchParams }: PageProps<"/reports">) {
  return (
    <Suspense fallback={<LoadingShell />}>
      <Reports searchParams={searchParams} />
    </Suspense>
  );
}

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

// Owners only: what the salon owes in gift cards and packages, gift card
// activity, and the day's close-out.
async function Reports({ searchParams }: Pick<PageProps<"/reports">, "searchParams">) {
  const [params, { supabase, staff: me }] = await Promise.all([searchParams, getCurrentStaff()]);
  if (!me) return <NotLinked />;
  if (me.role !== "owner") redirect("/dashboard");
  const tz = me.location.timezone;
  const today = todayIn(tz);
  const period: Period = typeof params.period === "string" && params.period in PERIODS ? (params.period as Period) : "this_month";
  const day = typeof params.day === "string" && isLocalDate(params.day) && params.day <= today ? params.day : today;
  const range = rangeOf(period, today);
  const [liability, packages, activity, close, rebooking, staff] = await Promise.all([
    loadGiftCardLiability(supabase, me.business_id),
    loadUnusedPackages(supabase, me.business_id),
    loadGiftCardActivity(supabase, me.business_id, range.from, range.to, tz),
    loadCloseout(supabase, me.location, day),
    loadRebooking(supabase, me.location, range.from, range.to),
    supabase.from("staff").select("id, first_name, last_name").eq("business_id", me.business_id),
  ]);
  const staffName = new Map((staff.data ?? []).map((s) => [s.id, `${s.first_name} ${s.last_name}`]));
  const link = (q: { period?: Period; day?: string }) => {
    const s = new URLSearchParams();
    if ((q.period ?? period) !== "this_month") s.set("period", q.period ?? period);
    if ((q.day ?? day) !== today) s.set("day", q.day ?? day);
    return s.size ? `/reports?${s}` : "/reports";
  };

  return (
    <AppShell section="reports" me={me}>
      <PageHeader title="Reports" description="What you owe in gift cards and packages, gift card activity, rebooking, and closing out the day." />

      <Card title="What you owe in services" titleId="owed-heading" description="Gift card balances and unused package uses are services clients have paid for and not had yet.">
        <dl className="grid gap-5 sm:grid-cols-3" data-testid="liabilities">
          <Stat label="Gift card balances" value={formatPrice(liability.purchased.cents)} note={`On ${liability.purchased.count} cards`} testId="gift-card-liability" />
          <Stat label="Unused package uses" value={formatPrice(packages.cents)} note={`${packages.uses} uses, ${packages.clients} clients`} testId="package-liability" />
          <Stat label="Promotional credit out" value={formatPrice(liability.promotional.cents)} note={`On ${liability.promotional.count} cards; no cash value`} />
        </dl>
        {liability.expired.cents > 0 && (
          <p className="mt-4 text-sm text-ink-muted">
            {formatPrice(liability.expired.cents)} sits on {liability.expired.count} expired cards. What happens to unused balances depends on your state&apos;s law.
          </p>
        )}
        {packages.clients.length > 0 && (
          <details className="mt-4">
            <summary className="cursor-pointer text-sm font-medium text-link">Who has unused packages ({packages.clients.length})</summary>
            <ul className="mt-2 divide-y divide-line text-sm" aria-label="Clients with unused packages">
              {packages.clients.slice(0, 50).map((c) => (
                <li key={c.clientId} className="flex justify-between gap-3 py-2">
                  <Link href={`/clients/${c.clientId}`} className="text-ink hover:underline">
                    {c.firstName} {c.lastName}
                    <span className="text-ink-muted"> · {c.uses.join(", ")}</span>
                  </Link>
                  <span className="tabular-nums">{formatPrice(c.cents)}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </Card>

      <Card
        title="Gift cards sold and used"
        titleId="activity-heading"
        description={`${formatLongDay(range.from, false)} to ${formatLongDay(range.to, false)}`}
        actions={
          <nav aria-label="Period" className="flex flex-wrap gap-2">
            {(Object.keys(PERIODS) as Period[]).map((p) => (
              <Link key={p} href={link({ period: p })} className={pillClass(p === period)} aria-current={p === period ? "page" : undefined}>
                {PERIODS[p]}
              </Link>
            ))}
          </nav>
        }
      >
        <dl className="grid gap-5 sm:grid-cols-4" data-testid="gift-card-activity">
          <Stat label="Sold" value={formatPrice(activity.soldCents)} note={`${activity.soldCount} cards`} testId="gift-cards-sold" />
          <Stat label="Reloaded" value={formatPrice(activity.reloadedCents)} />
          <Stat label="Used" value={formatPrice(activity.redeemedCents)} testId="gift-cards-redeemed" />
          <Stat label="Promotional used" value={formatPrice(activity.promoRedeemedCents)} note={`${formatPrice(activity.promoIssuedCents)} issued`} />
        </dl>
      </Card>

      <Card
        title="Rebooked at checkout"
        titleId="rebook-heading"
        description={`Visits checked out ${formatLongDay(range.from, false)} to ${formatLongDay(range.to, false)} where the client left with their next visit booked, by stylist.`}
      >
        {rebooking.visits === 0 ? (
          <p className="text-sm text-ink-muted">No visits checked out in this period.</p>
        ) : (
          <>
            <p className="mb-3">
              <strong className="font-serif text-3xl text-navy-900 tabular-nums" data-testid="rebook-rate">
                {rebooking.percent}%
              </strong>{" "}
              <span className="text-ink-muted">
                of {rebooking.visits} visits ({rebooking.rebooked} rebooked)
              </span>
            </p>
            <table className="w-full text-sm tabular-nums" aria-label="Rebooking by stylist">
              <thead>
                <tr className="text-left text-ink-muted">
                  <th className="py-1 font-medium">Stylist</th>
                  <th className="py-1 text-right font-medium">Visits</th>
                  <th className="py-1 text-right font-medium">Rebooked</th>
                  <th className="py-1 text-right font-medium">Rate</th>
                </tr>
              </thead>
              <tbody>
                {rebooking.stylists.map((s) => (
                  <tr key={s.staffId} className="border-t border-line">
                    <td className="py-1.5">{staffName.get(s.staffId) ?? "Former staff"}</td>
                    <td className="py-1.5 text-right">{s.visits}</td>
                    <td className="py-1.5 text-right">{s.rebooked}</td>
                    <td className="py-1.5 text-right font-medium">{s.percent}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </Card>

      <Card
        title="Close out the day"
        titleId="closeout-heading"
        description={formatLongDay(day)}
        actions={
          <nav aria-label="Day" className="flex gap-2">
            <Link href={link({ day: addDays(day, -1) })} className={pillClass(false)}>
              ← Previous day
            </Link>
            {day < today && (
              <Link href={link({ day: addDays(day, 1) })} className={pillClass(false)}>
                Next day →
              </Link>
            )}
          </nav>
        }
      >
        <table className="mb-4 w-full text-sm tabular-nums" aria-label="Sales by tender">
          <thead>
            <tr className="text-left text-ink-muted">
              <th className="py-1 font-medium">Tender</th>
              <th className="py-1 text-right font-medium">Taken</th>
              <th className="py-1 text-right font-medium">Refunded</th>
              <th className="py-1 text-right font-medium">Net</th>
            </tr>
          </thead>
          <tbody>
            {close.byMethod.map((m) => (
              <tr key={m.method} className="border-t border-line">
                <td className="py-1.5">{METHOD_LABELS[m.method]}</td>
                <td className="py-1.5 text-right">{formatPrice(m.takenCents)}</td>
                <td className="py-1.5 text-right">{m.refundedCents ? `−${formatPrice(m.refundedCents)}` : "—"}</td>
                <td className="py-1.5 text-right font-medium">{formatPrice(m.netCents)}</td>
              </tr>
            ))}
            <tr className="border-t border-line-strong font-semibold">
              <td className="py-1.5">All</td>
              <td />
              <td />
              <td className="py-1.5 text-right">{formatPrice(close.netCents)}</td>
            </tr>
          </tbody>
        </table>
        <p className="mb-3">
          Cash expected in the drawer: <strong className="tabular-nums" data-testid="expected-cash">{formatPrice(close.expectedCashCents)}</strong>
          {close.saved && (
            <span className="text-ink-muted" data-testid="closeout-saved">
              {" "}
              · counted {formatPrice(close.saved.counted_cents)}
              {close.saved.counted_cents === close.saved.expected_cents
                ? ", matches"
                : `, ${formatPrice(Math.abs(close.saved.counted_cents - close.saved.expected_cents))} ${close.saved.counted_cents > close.saved.expected_cents ? "over" : "short"}`}
              {close.saved.staff ? ` (${close.saved.staff.first_name})` : ""}
            </span>
          )}
        </p>
        <CloseoutForm key={day} day={day} counted={close.saved?.counted_cents ?? null} note={close.saved?.note ?? ""} />
      </Card>
    </AppShell>
  );
}
