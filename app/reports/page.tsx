import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AppShell, LoadingShell, NotLinked } from "@/components/app-shell";
import { Card, PageHeader, pillClass } from "@/components/ui/page";
import { getCurrentStaff } from "@/lib/auth";
import { TENDER_LABELS } from "@/lib/reports";
import { membershipReport } from "@/lib/memberships";
import { loadMembershipRows } from "@/lib/memberships-load";
import { loadBookingSources, loadCloseout, loadGiftCardActivity, loadGiftCardLiability, loadRebooking, loadUnusedPackages } from "@/lib/reports-load";
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
  const [liability, packages, activity, close, rebooking, staff, membershipRows, sources] = await Promise.all([
    loadGiftCardLiability(supabase, me.business_id),
    loadUnusedPackages(supabase, me.business_id),
    loadGiftCardActivity(supabase, me.business_id, range.from, range.to, tz),
    loadCloseout(supabase, me.business_id, me.location, day),
    loadRebooking(supabase, me.location, range.from, range.to),
    supabase.from("staff").select("id, first_name, last_name").eq("business_id", me.business_id),
    loadMembershipRows(supabase, me.business_id, tz),
    loadBookingSources(supabase, me.location, range.from, range.to),
  ]);
  const members = membershipReport(membershipRows, range.from, range.to);
  const staffName = new Map((staff.data ?? []).map((s) => [s.id, `${s.first_name} ${s.last_name}`]));
  const link = (q: { period?: Period; day?: string }) => {
    const s = new URLSearchParams();
    if ((q.period ?? period) !== "this_month") s.set("period", q.period ?? period);
    if ((q.day ?? day) !== today) s.set("day", q.day ?? day);
    return s.size ? `/reports?${s}` : "/reports";
  };

  return (
    <AppShell section="reports" me={me}>
      {/* The period is the whole page's: every report below but what's owed now and the close-out follows it. */}
      <PageHeader
        title="Reports"
        description={
          <>
            What you owe in gift cards and packages, gift card activity, memberships, where online bookings came from, rebooking, and closing out the day.
            <span className="mt-1 block text-sm" data-testid="report-period">
              Showing {formatLongDay(range.from, false)} to {formatLongDay(range.to, false)}
            </span>
          </>
        }
        actions={
          <nav aria-label="Period" className="flex flex-wrap gap-2">
            {(Object.keys(PERIODS) as Period[]).map((p) => (
              <Link key={p} href={link({ period: p })} className={pillClass(p === period)} aria-current={p === period ? "page" : undefined}>
                {PERIODS[p]}
              </Link>
            ))}
          </nav>
        }
      />

      <Card title="What you owe in services" titleId="owed-heading" description="As of now, whatever the period: gift card balances and unused package uses are services clients have paid for and not had yet.">
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
      >
        <dl className="grid gap-5 sm:grid-cols-4" data-testid="gift-card-activity">
          <Stat label="Sold" value={formatPrice(activity.soldCents)} note={`${activity.soldCount} cards`} testId="gift-cards-sold" />
          <Stat label="Reloaded" value={formatPrice(activity.reloadedCents)} />
          <Stat label="Used" value={formatPrice(activity.redeemedCents)} testId="gift-cards-redeemed" />
          <Stat label="Promotional used" value={formatPrice(activity.promoRedeemedCents)} note={`${formatPrice(activity.promoIssuedCents)} issued`} />
        </dl>
      </Card>

      <Card
        title="Memberships"
        titleId="memberships-heading"
        description={`Members now and what they bring in each month; joined and churn for ${formatLongDay(range.from, false)} to ${formatLongDay(range.to, false)}.`}
      >
        <dl className="grid gap-5 sm:grid-cols-4" data-testid="membership-report">
          <Stat label="Members" value={String(members.members)} note={[members.pastDue && `${members.pastDue} payment failed`, members.paused && `${members.paused} paused`].filter(Boolean).join(" · ") || undefined} testId="members" />
          <Stat label="Monthly recurring revenue" value={formatPrice(members.mrrCents)} note="Active and past-due members, as a monthly amount" testId="mrr" />
          <Stat label="Joined" value={String(members.joined)} />
          <Stat
            label="Churn"
            value={members.churnPercent === null ? "—" : `${members.churnPercent}%`}
            note={members.startingMembers ? `${members.churned} of ${members.startingMembers} members at the start ended` : "No members at the start"}
            testId="churn"
          />
        </dl>
        {members.plans.length > 0 && (
          <table className="mt-4 w-full text-sm tabular-nums" aria-label="Members by membership">
            <thead>
              <tr className="text-left text-ink-muted">
                <th className="py-1 font-medium">Membership</th>
                <th className="py-1 text-right font-medium">Members</th>
                <th className="py-1 text-right font-medium">Monthly</th>
              </tr>
            </thead>
            <tbody>
              {members.plans.map((p) => (
                <tr key={p.name} className="border-t border-line">
                  <td className="py-1.5">{p.name}</td>
                  <td className="py-1.5 text-right">{p.members}</td>
                  <td className="py-1.5 text-right">{formatPrice(p.mrrCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card
        title="Where online bookings came from"
        titleId="sources-heading"
        description={`Booked online ${formatLongDay(range.from, false)} to ${formatLongDay(range.to, false)}, by the link they followed (Settings → Online booking has a link for each place).`}
      >
        {sources.total === 0 ? (
          <p className="text-sm text-ink-muted">No online bookings in this period.</p>
        ) : (
          <table className="w-full text-sm tabular-nums" aria-label="Online bookings by source">
            <thead>
              <tr className="text-left text-ink-muted">
                <th className="py-1 font-medium">From</th>
                <th className="py-1 text-right font-medium">Bookings</th>
                <th className="py-1 text-right font-medium">Came in</th>
                <th className="py-1 text-right font-medium">Revenue</th>
              </tr>
            </thead>
            <tbody>
              {sources.sources.map((src) => (
                <tr key={src.source} className="border-t border-line" data-testid="booking-source" data-source={src.source}>
                  <td className="py-1.5">{src.label}</td>
                  <td className="py-1.5 text-right">{src.bookings}</td>
                  <td className="py-1.5 text-right">{src.completed}</td>
                  <td className="py-1.5 text-right">{formatPrice(src.revenueCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
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
                <td className="py-1.5">{TENDER_LABELS[m.method]}</td>
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
        {close.saved && (
          <p className="mb-3 text-ink-muted" data-testid="closeout-saved">
            Counted {formatPrice(close.saved.counted_cents)} against {formatPrice(close.saved.expected_cents)} expected
            {close.saved.counted_cents === close.saved.expected_cents
              ? ": matches"
              : `: ${formatPrice(Math.abs(close.saved.counted_cents - close.saved.expected_cents))} ${close.saved.counted_cents > close.saved.expected_cents ? "over" : "short"}`}
            {close.saved.staff ? ` (${close.saved.staff.first_name})` : ""}
          </p>
        )}
        <CloseoutForm key={day} day={day} cashNetCents={close.cashNetCents} floatCents={close.floatCents} counted={close.saved?.counted_cents ?? null} note={close.saved?.note ?? ""} />
      </Card>
    </AppShell>
  );
}
