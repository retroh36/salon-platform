import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Fragment, Suspense } from "react";
import { AppShell, LoadingShell, NotLinked } from "@/components/app-shell";
import { buttonClass } from "@/components/ui/button";
import { fieldClass, labelClass } from "@/components/ui/field";
import { EmptyState, PageHeader, Section, textLinkClass } from "@/components/ui/page";
import { TableCard, numClass, tableClass, tdClass, thClass, theadClass, trClass } from "@/components/ui/table";
import { getCurrentStaff } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { MISS_LABELS, MISS_NOTES, notCharged, parseMissRange, type Incident } from "@/lib/policy-report";
import { formatDay } from "@/lib/schedule-format";
import { addDays, fromLocal, todayIn } from "@/lib/scheduling/time";
import { cents } from "../money";

export const metadata: Metadata = { title: "Not charged" };

export default function NotChargedPage({ searchParams }: PageProps<"/policy/not-charged">) {
  return (
    <Suspense fallback={<LoadingShell />}>
      <NotCharged searchParams={searchParams} />
    </Suspense>
  );
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// Every no-show and late cancellation in a period, what the visits were
// booked for, and, for those with nothing collected, why: no card, a card
// declined, waived (with staff's reasons), waiting, or no fee under the
// policy. Totals only, never clients, so a bookkeeper reads it too.
async function NotCharged({ searchParams }: Pick<PageProps<"/policy/not-charged">, "searchParams">) {
  const [params, { supabase, staff: me }] = await Promise.all([searchParams, getCurrentStaff()]);
  if (!me) return <NotLinked />;
  if (!can(me, "reports")) redirect("/dashboard");
  const tz = me.location.timezone;
  const today = todayIn(tz);
  const range = parseMissRange(params, today);
  const { data, error } = await supabase.rpc("policy_not_charged", {
    p_business_id: me.business_id,
    p_from: fromLocal(range.from, 0, tz)!.toISOString(),
    p_to: fromLocal(addDays(range.to, 1), 0, tz)!.toISOString(),
  });
  if (error) throw error;
  const r = notCharged(
    data.map((i): Incident => ({ kind: i.kind as Incident["kind"], visitCents: i.visit_cents, feeCents: i.fee_cents, collectedCents: i.collected_cents, status: i.status, waiveReason: i.waive_reason })),
  );
  const between = range.from === range.to ? formatDay(range.from) : `${formatDay(range.from)} to ${formatDay(range.to)}`;

  return (
    <AppShell section="policy" me={me}>
      <PageHeader title="Not charged, and why" description="No-shows and late cancellations by the day of the visit: what they were booked for, what the policy collected, and why the rest wasn't charged." />
      <form method="get" aria-label="Dates" className="mb-6 flex flex-wrap items-end gap-3">
        <label className={labelClass}>
          From
          <input type="date" name="from" defaultValue={range.from} max={today} className={`${fieldClass} w-40`} />
        </label>
        <label className={labelClass}>
          To
          <input type="date" name="to" defaultValue={range.to} max={today} className={`${fieldClass} w-40`} />
        </label>
        <button type="submit" className={buttonClass("secondary")}>
          Show
        </button>
        <Link href="/policy" className={`${textLinkClass} self-center text-sm`}>
          Back to Policy
        </Link>
      </form>

      <Section title={between} titleId="not-charged-heading">
        {r.incidents === 0 ? (
          <EmptyState title="No no-shows or late cancellations">Nothing went uncharged in these dates.</EmptyState>
        ) : (
          <>
            <dl className="grid grid-cols-2 divide-line overflow-hidden rounded-lg border border-line bg-surface max-lg:gap-px max-lg:bg-line lg:grid-cols-4 lg:divide-x">
              {[
                { label: "Booked value", value: r.visitCents, note: `${plural(r.noShows, "no-show")} · ${plural(r.lateCancels, "late cancellation")}`, id: "miss-booked" },
                { label: "Collected", value: r.collectedCents, note: "Fees and kept deposits", id: "miss-collected" },
                { label: "Not charged", value: r.notChargedCents, note: "Booked value with no fee collected", id: "miss-not-charged" },
                { label: "Fees not collected", value: r.uncollectedFeeCents, note: "Fees the policy set", id: "miss-fees" },
              ].map((s) => (
                <div key={s.id} className="flex flex-col gap-1 bg-surface px-4 py-3">
                  <dt className="text-13 text-ink-muted">{s.label}</dt>
                  <dd className="text-2xl font-semibold tracking-[-0.015em] text-ink tabular-nums" data-testid={s.id}>
                    {cents(s.value)}
                  </dd>
                  <dd className="text-xs text-ink-subtle tabular-nums">{s.note}</dd>
                </div>
              ))}
            </dl>

            {r.rows.length === 0 ? (
              <p className="mt-4 text-sm text-ink-muted">Every fee was charged.</p>
            ) : (
              <TableCard className="mt-4">
                <table className={tableClass} aria-label="Why not charged" data-testid="miss-reasons">
                  <thead className={theadClass}>
                    <tr>
                      <th className={thClass}>Why</th>
                      <th className={`${thClass} ${numClass}`}>Visits</th>
                      <th className={`${thClass} ${numClass}`}>Not charged</th>
                      <th className={`${thClass} ${numClass}`}>Fees not collected</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.rows.map((row) => (
                      <Fragment key={row.reason}>
                        <tr className={trClass} data-reason={row.reason}>
                          <td className={tdClass}>
                            <span className="font-medium text-ink">{MISS_LABELS[row.reason]}</span>
                            <span className="block text-xs text-ink-muted">{MISS_NOTES[row.reason]}</span>
                          </td>
                          <td className={`${tdClass} ${numClass}`}>{row.count}</td>
                          <td className={`${tdClass} ${numClass} font-medium text-ink`}>{cents(row.visitCents)}</td>
                          <td className={`${tdClass} ${numClass}`}>{row.uncollectedCents ? cents(row.uncollectedCents) : "—"}</td>
                        </tr>
                        {row.reasons.map((t) => (
                          <tr key={t.text} className={trClass} data-waive-reason>
                            <td className={`${tdClass} pl-8 text-ink-muted`}>{t.text}</td>
                            <td className={`${tdClass} ${numClass} text-ink-muted`}>{t.count}</td>
                            <td className={`${tdClass} ${numClass} text-ink-muted`}>{cents(t.cents)}</td>
                            <td className={tdClass} />
                          </tr>
                        ))}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </TableCard>
            )}
            <p className="mt-3 text-13 text-ink-muted">A fee the policy set below the visit&apos;s price counts as charged once it&apos;s collected. Card charges are in test mode until card payments are connected.</p>
          </>
        )}
      </Section>
    </AppShell>
  );
}
