import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AppShell, LoadingShell, NotLinked } from "@/components/app-shell";
import { EmptyState, PageHeader, Section, nameLinkClass } from "@/components/ui/page";
import { buttonClass } from "@/components/ui/button";
import { TableCard, numClass, tableClass, tdClass, thClass, theadClass, trClass } from "@/components/ui/table";
import { getCurrentStaff } from "@/lib/auth";
import { TENDER_LABELS } from "@/lib/reports";
import { membershipReport } from "@/lib/memberships";
import { loadMembershipRows } from "@/lib/memberships-load";
import { loadBookingSources, loadPromotionResults, loadCloseout, loadGiftCardActivity, loadGiftCardLiability, loadRebooking, loadUnusedPackages } from "@/lib/reports-load";
import { formatLongDay } from "@/lib/schedule-format";
import { addDays, isLocalDate, todayIn } from "@/lib/scheduling/time";
import { formatPrice } from "@/lib/services";
import { CloseoutForm } from "./closeout-form";
import { eventReport } from "@/lib/events/report";
import { loadEventReportRows } from "@/lib/events/report-load";
import { can } from "@/lib/permissions";
import { points } from "@/lib/rewards";
import { loadRewardsOverview } from "@/lib/rewards-load";
import { startOfLocalDay } from "@/lib/scheduling/load";

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
    <div className="px-4 py-3">
      <dt className="text-13 text-ink-muted">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold text-ink tabular-nums" data-testid={testId}>
        {value}
      </dd>
      {note && <p className="mt-0.5 text-xs text-ink-subtle">{note}</p>}
    </div>
  );
}

// Stats as one bordered strip divided into cells.
function Stats({ cols, testId, className = "", children }: { cols: 3 | 4; testId?: string; className?: string; children: React.ReactNode }) {
  const grid = cols === 3 ? "sm:grid-cols-3 sm:divide-x sm:divide-y-0" : "sm:grid-cols-4 sm:divide-x sm:divide-y-0";
  return (
    <dl className={`grid divide-y divide-line rounded-lg border border-line bg-surface ${grid} ${className}`} data-testid={testId}>
      {children}
    </dl>
  );
}

// Owners only: what the salon owes in gift cards and packages, gift card
// activity, and the day's close-out.
async function Reports({ searchParams }: Pick<PageProps<"/reports">, "searchParams">) {
  const [params, { supabase, staff: me }] = await Promise.all([searchParams, getCurrentStaff()]);
  if (!me) return <NotLinked />;
  if (!can(me, "reports")) redirect("/dashboard");
  const tz = me.location.timezone;
  const today = todayIn(tz);
  const period: Period = typeof params.period === "string" && params.period in PERIODS ? (params.period as Period) : "this_month";
  const day = typeof params.day === "string" && isLocalDate(params.day) && params.day <= today ? params.day : today;
  const range = rangeOf(period, today);
  const [liability, packages, activity, close, rebooking, staff, membershipRows, sources, promotions, eventRows, rewards] = await Promise.all([
    loadGiftCardLiability(supabase, me.business_id),
    loadUnusedPackages(supabase, me.business_id),
    loadGiftCardActivity(supabase, me.business_id, range.from, range.to, tz),
    loadCloseout(supabase, me.business_id, me.location, day),
    loadRebooking(supabase, me.location, range.from, range.to),
    supabase.from("staff").select("id, first_name, last_name").eq("business_id", me.business_id),
    loadMembershipRows(supabase, me.business_id, tz),
    loadBookingSources(supabase, me.location, range.from, range.to),
    loadPromotionResults(supabase, me.business_id, range.from, range.to, tz),
    loadEventReportRows(supabase, me.business_id, tz),
    loadRewardsOverview(supabase, me.business_id, startOfLocalDay(range.from, tz), startOfLocalDay(addDays(range.to, 1), tz)),
  ]);
  const events = eventReport(eventRows, range.from, range.to);
  // By month: six months back to six ahead, whatever the period.
  const monthStart = `${today.slice(0, 7)}-01`;
  const shiftMonths = (n: number) => {
    const [y, m] = monthStart.split("-").map(Number);
    const d = new Date(Date.UTC(y, m - 1 + n, 1));
    return d.toISOString().slice(0, 10);
  };
  const eventMonths = eventReport(eventRows, shiftMonths(-6), addDays(shiftMonths(7), -1)).months;
  const monthName = (month: string) => new Date(`${month}-15T12:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  const members = membershipReport(membershipRows, range.from, range.to);
  const staffName = new Map((staff.data ?? []).map((s) => [s.id, `${s.first_name} ${s.last_name}`]));
  const link = (q: { period?: Period; day?: string }) => {
    const s = new URLSearchParams();
    if ((q.period ?? period) !== "this_month") s.set("period", q.period ?? period);
    if ((q.day ?? day) !== today) s.set("day", q.day ?? day);
    return s.size ? `/reports?${s}` : "/reports";
  };

  const between = `${formatLongDay(range.from, false)} to ${formatLongDay(range.to, false)}`;
  const th = thClass;
  const thNum = `${thClass} text-right`;
  const td = tdClass;
  const tdNum = `${tdClass} ${numClass}`;

  return (
    <AppShell section="reports" me={me}>
      {/* The period is the whole page's: every report below but what's owed now and the close-out follows it. */}
      <PageHeader
        title="Reports"
        description={
          <>
            What you owe in gift cards and packages, gift card activity, memberships, rewards, bridal and events, where online bookings came from, rebooking, and closing out the day.
            <span className="mt-1 block text-13 text-ink-subtle" data-testid="report-period">
              Showing {formatLongDay(range.from, false)} to {formatLongDay(range.to, false)}
            </span>
          </>
        }
        actions={
          <nav aria-label="Period" className="inline-flex h-9 items-center rounded-md border border-line-strong bg-surface p-0.5">
            {(Object.keys(PERIODS) as Period[]).map((p) => (
              <Link
                key={p}
                href={link({ period: p })}
                aria-current={p === period ? "page" : undefined}
                className={`touch-target inline-flex h-full items-center rounded-[6px] px-3 text-sm font-medium whitespace-nowrap transition-colors duration-(--motion-fast) focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus ${
                  p === period ? "bg-sunken text-ink" : "text-ink-muted hover:text-ink"
                }`}
              >
                {PERIODS[p]}
              </Link>
            ))}
          </nav>
        }
      />

      <Section title="What you owe in services" titleId="owed-heading" description="As of now, whatever the period: gift card balances and unused package uses are services clients have paid for and not had yet.">
        <Stats cols={3} testId="liabilities">
          <Stat label="Gift card balances" value={formatPrice(liability.purchased.cents)} note={`On ${liability.purchased.count} cards`} testId="gift-card-liability" />
          <Stat label="Unused package uses" value={formatPrice(packages.cents)} note={`${packages.uses} uses, ${packages.clients.length} clients`} testId="package-liability" />
          <Stat label="Promotional credit out" value={formatPrice(liability.promotional.cents)} note={`On ${liability.promotional.count} cards; no cash value`} />
        </Stats>
        {liability.expired.cents > 0 && (
          <p className="mt-3 text-13 text-ink-muted">
            {formatPrice(liability.expired.cents)} sits on {liability.expired.count} expired cards. What happens to unused balances depends on your state&apos;s law.
          </p>
        )}
        {packages.clients.length > 0 && (
          <details className="group mt-3">
            <summary className={buttonClass("quiet", "sm", "-ml-3 cursor-pointer list-none")}>
              Who has unused packages <span className="text-ink-subtle tabular-nums">({packages.clients.length})</span>
            </summary>
            <TableCard className="mt-2 mb-0">
              <table className={tableClass} aria-label="Clients with unused packages">
                <thead className={theadClass}>
                  <tr>
                    <th className={th}>Client</th>
                    <th className={th}>Uses left</th>
                    <th className={thNum}>Worth</th>
                  </tr>
                </thead>
                <tbody>
                  {packages.clients.slice(0, 50).map((c) => (
                    <tr key={c.clientId} className={trClass}>
                      <td className={td}>
                        <Link href={`/clients/${c.clientId}`} className={nameLinkClass}>
                          {c.firstName} {c.lastName}
                        </Link>
                      </td>
                      <td className={`${td} text-ink-muted`}>{c.uses.join(", ")}</td>
                      <td className={tdNum}>{formatPrice(c.cents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableCard>
          </details>
        )}
      </Section>

      <Section title="Gift cards sold and used" titleId="activity-heading" description={between}>
        <Stats cols={4} testId="gift-card-activity">
          <Stat label="Sold" value={formatPrice(activity.soldCents)} note={`${activity.soldCount} cards`} testId="gift-cards-sold" />
          <Stat label="Reloaded" value={formatPrice(activity.reloadedCents)} />
          <Stat label="Used" value={formatPrice(activity.redeemedCents)} testId="gift-cards-redeemed" />
          <Stat label="Promotional used" value={formatPrice(activity.promoRedeemedCents)} note={`${formatPrice(activity.promoIssuedCents)} issued`} />
        </Stats>
      </Section>

      <Section title="Memberships" titleId="memberships-heading" description={`Members now and what they bring in each month; joined and churn for ${between}.`}>
        <Stats cols={4} testId="membership-report">
          <Stat label="Members" value={String(members.members)} note={[members.pastDue && `${members.pastDue} payment failed`, members.paused && `${members.paused} paused`].filter(Boolean).join(" · ") || undefined} testId="members" />
          <Stat label="Monthly recurring revenue" value={formatPrice(members.mrrCents)} note="Active and past-due members, as a monthly amount" testId="mrr" />
          <Stat label="Joined" value={String(members.joined)} />
          <Stat
            label="Churn"
            value={members.churnPercent === null ? "—" : `${members.churnPercent}%`}
            note={members.startingMembers ? `${members.churned} of ${members.startingMembers} members at the start ended` : "No members at the start"}
            testId="churn"
          />
        </Stats>
        {members.plans.length > 0 && (
          <TableCard className="mt-3 mb-0">
            <table className={tableClass} aria-label="Members by membership">
              <thead className={theadClass}>
                <tr>
                  <th className={th}>Membership</th>
                  <th className={thNum}>Members</th>
                  <th className={thNum}>Monthly</th>
                </tr>
              </thead>
              <tbody>
                {members.plans.map((p) => (
                  <tr key={p.name} className={trClass}>
                    <td className={`${td} font-medium text-ink`}>{p.name}</td>
                    <td className={tdNum}>{p.members}</td>
                    <td className={tdNum}>{formatPrice(p.mrrCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableCard>
        )}
      </Section>

      <Section
        title="Promotions"
        titleId="promotions-heading"
        description={`Sales ${between} that used a promotion: what they brought in (after tax, tips and refunds), what the discounts cost, openings filled by last-minute specials, and first visits.`}
      >
        {promotions.length === 0 ? (
          <TableCard className="mb-0">
            <EmptyState art={false}>No promotions used in this period.</EmptyState>
          </TableCard>
        ) : (
          <TableCard className="mb-0">
            <table className={tableClass} aria-label="Promotion results">
              <thead className={theadClass}>
                <tr>
                  <th className={th}>Promotion</th>
                  <th className={thNum}>Used</th>
                  <th className={thNum}>Revenue</th>
                  <th className={thNum}>Discounts</th>
                  <th className={thNum}>Gaps filled</th>
                  <th className={thNum}>New clients</th>
                </tr>
              </thead>
              <tbody>
                {promotions.map((p) => (
                  <tr key={p.promotionId} className={trClass} data-testid="promotion-result">
                    <td className={`${td} font-medium text-ink`}>{p.name}</td>
                    <td className={tdNum}>{p.redemptions}</td>
                    <td className={tdNum}>{formatPrice(p.revenueCents)}</td>
                    <td className={tdNum}>−{formatPrice(p.discountCents)}</td>
                    <td className={tdNum}>{p.gapsFilled}</td>
                    <td className={tdNum}>{p.newClients}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableCard>
        )}
      </Section>

      {rewards && (
        <Section
          title="Rewards"
          titleId="rewards-heading"
          description={`Points earned, redeemed and expired ${between}; what's outstanding and members by tier as of now. Outstanding points are valued at the best amount-off reward: an estimate, not a cash debt.`}
        >
          <Stats cols={4} testId="rewards-report">
            <Stat label="Earned" value={points(rewards.overview.earned)} note={rewards.overview.bonus ? `${points(rewards.overview.bonus)} of it bonuses` : undefined} testId="points-earned" />
            <Stat
              label="Redeemed"
              value={points(rewards.overview.redeemed)}
              note={`${rewards.overview.redemptions} ${rewards.overview.redemptions === 1 ? "reward" : "rewards"} · ${formatPrice(rewards.overview.discountCents)} off`}
              testId="points-redeemed"
            />
            <Stat
              label="Outstanding"
              value={points(rewards.overview.outstanding)}
              note={rewards.overview.outstandingCents ? `About ${formatPrice(rewards.overview.outstandingCents)} in rewards` : undefined}
              testId="points-outstanding"
            />
            <Stat
              label="Redemption rate"
              value={rewards.overview.redemptionRate === null ? "—" : `${rewards.overview.redemptionRate}%`}
              note={rewards.overview.expired ? `${points(rewards.overview.expired)} expired` : "Of the points earned"}
              testId="redemption-rate"
            />
          </Stats>
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            {rewards.overview.byTier.length > 0 && (
              <TableCard className="mb-0">
                <table className={tableClass} aria-label="Members by tier">
                  <thead className={theadClass}>
                    <tr>
                      <th className={th}>Tier</th>
                      <th className={thNum}>Clients</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rewards.overview.byTier.map((t) => (
                      <tr key={t.tierId ?? "none"} className={trClass}>
                        <td className={`${td} font-medium text-ink`}>{t.name}</td>
                        <td className={tdNum}>{t.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableCard>
            )}
            <TableCard className="mb-0">
              <table className={tableClass} aria-label="Referrals">
                <thead className={theadClass}>
                  <tr>
                    <th className={th}>Referrals</th>
                    <th className={thNum}>This period</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className={trClass}>
                    <td className={td}>New clients referred</td>
                    <td className={tdNum}>{rewards.overview.referrals.referred}</td>
                  </tr>
                  <tr className={trClass}>
                    <td className={td}>Came in for their first visit</td>
                    <td className={tdNum} data-testid="referrals-completed">
                      {rewards.overview.referrals.completed}
                    </td>
                  </tr>
                  <tr className={trClass}>
                    <td className={td}>Points given for referrals</td>
                    <td className={tdNum}>{rewards.overview.referrals.points.toLocaleString("en-US")}</td>
                  </tr>
                </tbody>
              </table>
            </TableCard>
          </div>
        </Section>
      )}

      <Section
        title="Bridal and events"
        titleId="events-heading"
        description={`Events held ${between} (booked or completed, by the event's date), inquiries that came in then, and deposits.`}
      >
        <div data-testid="event-report" className="flex flex-col gap-3">
          <Stats cols={3}>
            <Stat label="Events held" value={formatPrice(events.valueCents)} note={`${events.held} ${events.held === 1 ? "event" : "events"}`} testId="event-value" />
            <Stat label="Average event" value={events.averageCents === null ? "—" : formatPrice(events.averageCents)} testId="event-average" />
            <Stat
              label="Inquiries booked"
              value={events.bookedRate === null ? "—" : `${Math.round(events.bookedRate * 100)}%`}
              note={`${events.booked} of ${events.inquiries} that came in`}
              testId="event-booked-rate"
            />
          </Stats>
          <Stats cols={3}>
            <Stat label="Deposits collected" value={formatPrice(events.depositsCollectedCents)} testId="event-deposits" />
            <Stat
              label="Deposits waiting"
              value={formatPrice(events.depositsOutstandingCents)}
              note={`${events.depositsOutstanding} ${events.depositsOutstanding === 1 ? "proposal" : "proposals"} out`}
              testId="event-deposits-waiting"
            />
            <Stat label="Still to collect" value={formatPrice(events.stillToCollectCents)} note="On booked events, as of now" testId="event-to-collect" />
          </Stats>
        </div>
        <h3 className="mt-6 mb-2 text-13 font-medium text-ink-muted">By month</h3>
        {eventMonths.length === 0 ? (
          <TableCard className="mb-0">
            <EmptyState art={false}>No events booked in the six months either side of this one.</EmptyState>
          </TableCard>
        ) : (
          <TableCard className="mb-0">
            <table className={tableClass} aria-label="Events by month">
              <thead className={theadClass}>
                <tr>
                  <th className={th}>Month</th>
                  <th className={thNum}>Events</th>
                  <th className={thNum}>Value</th>
                  <th className={thNum}>Collected</th>
                </tr>
              </thead>
              <tbody>
                {eventMonths.map((m) => (
                  <tr key={m.month} className={trClass} data-testid="event-month">
                    <td className={td}>{monthName(m.month)}</td>
                    <td className={tdNum}>{m.events}</td>
                    <td className={tdNum}>{formatPrice(m.valueCents)}</td>
                    <td className={tdNum}>{formatPrice(m.collectedCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableCard>
        )}
      </Section>

      <Section
        title="Where online bookings came from"
        titleId="sources-heading"
        description={`Booked online ${between}, by the link they followed (Settings → Online booking has a link for each place).`}
      >
        <TableCard className="mb-0">
          {sources.total === 0 ? (
            <EmptyState art={false}>No online bookings in this period.</EmptyState>
          ) : (
            <table className={tableClass} aria-label="Online bookings by source">
              <thead className={theadClass}>
                <tr>
                  <th className={th}>From</th>
                  <th className={thNum}>Bookings</th>
                  <th className={thNum}>Came in</th>
                  <th className={thNum}>Revenue</th>
                </tr>
              </thead>
              <tbody>
                {sources.sources.map((src) => (
                  <tr key={src.source} className={trClass} data-testid="booking-source" data-source={src.source}>
                    <td className={`${td} font-medium text-ink`}>{src.label}</td>
                    <td className={tdNum}>{src.bookings}</td>
                    <td className={tdNum}>{src.completed}</td>
                    <td className={tdNum}>{formatPrice(src.revenueCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </TableCard>
      </Section>

      <Section
        title="Rebooked at checkout"
        titleId="rebook-heading"
        description={`Visits checked out ${between} where the client left with their next visit booked, by stylist.`}
      >
        {rebooking.visits === 0 ? (
          <TableCard className="mb-0">
            <EmptyState art={false}>No visits checked out in this period.</EmptyState>
          </TableCard>
        ) : (
          <>
            <Stats cols={3} className="mb-3">
              <Stat label="Rebooked" value={`${rebooking.percent}%`} note={`of ${rebooking.visits} visits`} testId="rebook-rate" />
              <Stat label="Visits checked out" value={String(rebooking.visits)} />
              <Stat label="Left with a booking" value={String(rebooking.rebooked)} />
            </Stats>
            <TableCard className="mb-0">
              <table className={tableClass} aria-label="Rebooking by stylist">
                <thead className={theadClass}>
                  <tr>
                    <th className={th}>Stylist</th>
                    <th className={thNum}>Visits</th>
                    <th className={thNum}>Rebooked</th>
                    <th className={thNum}>Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {rebooking.stylists.map((s) => (
                    <tr key={s.staffId} className={trClass}>
                      <td className={`${td} font-medium text-ink`}>{staffName.get(s.staffId) ?? "Former staff"}</td>
                      <td className={tdNum}>{s.visits}</td>
                      <td className={tdNum}>{s.rebooked}</td>
                      <td className={`${tdNum} font-medium text-ink`}>{s.percent}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableCard>
          </>
        )}
      </Section>

      <Section
        title="Close out the day"
        titleId="closeout-heading"
        description={formatLongDay(day)}
        actions={
          <nav aria-label="Day" className="flex gap-2">
            <Link href={link({ day: addDays(day, -1) })} className={buttonClass("secondary", "sm")}>
              ← Previous day
            </Link>
            {day < today && (
              <Link href={link({ day: addDays(day, 1) })} className={buttonClass("secondary", "sm")}>
                Next day →
              </Link>
            )}
          </nav>
        }
      >
        <TableCard className="mb-4">
          <table className={tableClass} aria-label="Sales by tender">
            <thead className={theadClass}>
              <tr>
                <th className={th}>Tender</th>
                <th className={thNum}>Taken</th>
                <th className={thNum}>Refunded</th>
                <th className={thNum}>Net</th>
              </tr>
            </thead>
            <tbody>
              {close.byMethod.map((m) => (
                <tr key={m.method} className={trClass}>
                  <td className={td}>{TENDER_LABELS[m.method]}</td>
                  <td className={tdNum}>{formatPrice(m.takenCents)}</td>
                  <td className={tdNum}>{m.refundedCents ? `−${formatPrice(m.refundedCents)}` : "—"}</td>
                  <td className={`${tdNum} font-medium text-ink`}>{formatPrice(m.netCents)}</td>
                </tr>
              ))}
              <tr className="border-t border-line-strong bg-sunken/40 font-semibold">
                <td className={td}>All</td>
                <td className={td} />
                <td className={td} />
                <td className={tdNum}>{formatPrice(close.netCents)}</td>
              </tr>
            </tbody>
          </table>
        </TableCard>
        {close.saved && (
          <p className="mb-3 text-13 text-ink-muted" data-testid="closeout-saved">
            Counted {formatPrice(close.saved.counted_cents)} against {formatPrice(close.saved.expected_cents)} expected
            {close.saved.counted_cents === close.saved.expected_cents
              ? ": matches"
              : `: ${formatPrice(Math.abs(close.saved.counted_cents - close.saved.expected_cents))} ${close.saved.counted_cents > close.saved.expected_cents ? "over" : "short"}`}
            {close.saved.staff ? ` (${close.saved.staff.first_name})` : ""}
          </p>
        )}
        <CloseoutForm key={day} day={day} cashNetCents={close.cashNetCents} floatCents={close.floatCents} counted={close.saved?.counted_cents ?? null} note={close.saved?.note ?? ""} />
      </Section>
    </AppShell>
  );
}
