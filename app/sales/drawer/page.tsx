import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AppShell, LoadingShell, NotLinked } from "@/components/app-shell";
import { buttonClass } from "@/components/ui/button";
import { Alert, Badge, PageHeader, Section, nameLinkClass } from "@/components/ui/page";
import { TableCard, numClass, tableClass, tdClass, thClass, theadClass, trClass } from "@/components/ui/table";
import { getCurrentStaff } from "@/lib/auth";
import { COUNT_LABELS, differenceText, movesBefore } from "@/lib/drawer";
import { loadDrawer } from "@/lib/drawer-load";
import { can } from "@/lib/permissions";
import { formatLongDay } from "@/lib/schedule-format";
import { formatMinute, toLocal, todayIn } from "@/lib/scheduling/time";
import { formatPrice } from "@/lib/services";
import { isFrontOfHouse } from "@/lib/staff";
import { CountForm } from "./count-form";

export const metadata: Metadata = { title: "Cash drawer" };

export default function DrawerPage() {
  return (
    <Suspense fallback={<LoadingShell />}>
      <Drawer />
    </Suspense>
  );
}

// Today's cash drawer (the front of house): the opening count, counts during
// the day, the close-out once it's done, each against what it should hold,
// and the day's cash with who took it, to look into a difference.
async function Drawer() {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me) return <NotLinked />;
  if (!isFrontOfHouse(me.role)) redirect("/my-day");
  const tz = me.location.timezone;
  const today = todayIn(tz);
  const d = await loadDrawer(supabase, me.business_id, me.location, today);
  const time = (iso: string) => formatMinute(toLocal(new Date(iso), tz).minute);
  const closed = d.counts.some((c) => c.kind === "close");
  const netCash = d.moves.reduce((sum, m) => sum + m.amountCents, 0);
  return (
    <AppShell section="sales" me={me}>
      <PageHeader
        title="Cash drawer"
        description={formatLongDay(today)}
        actions={
          can(me, "reports") ? (
            <Link href="/reports#closeout-heading" className={buttonClass("secondary")}>
              Close out the day
            </Link>
          ) : undefined
        }
      />
      {!d.opening && !closed && (
        <div className="mb-6" data-testid="drawer-not-opened">
          <Alert tone="warning">The drawer hasn&rsquo;t been counted today. Count it before taking cash.</Alert>
        </div>
      )}
      {!closed && (
        <Section title={d.opening ? "Count the drawer" : "Opening count"} titleId="drawer-count-heading" description={d.opening ? "Count it whenever you like: at a shift change, or before a cash drop." : "Count the cash in the drawer before the first sale."}>
          <CountForm kind={d.opening ? "mid" : "open"} />
        </Section>
      )}
      <Section title="Today" titleId="drawer-today-heading" description={`Cash today: ${formatPrice(netCash)} net${d.moves.length ? `, from ${d.moves.length} payment${d.moves.length === 1 ? "" : "s"} and refunds` : ""}.`}>
        {d.counts.length === 0 ? (
          <p className="text-sm text-ink-muted">No counts yet today.</p>
        ) : (
          <TableCard>
            <table className={tableClass} data-testid="drawer-counts">
              <thead className={theadClass}>
                <tr>
                  <th className={thClass}>Time</th>
                  <th className={thClass}>Count</th>
                  <th className={thClass}>By</th>
                  <th className={`${thClass} ${numClass}`}>Expected</th>
                  <th className={`${thClass} ${numClass}`}>Counted</th>
                  <th className={thClass}>Difference</th>
                </tr>
              </thead>
              <tbody>
                {d.counts.map((c) => {
                  const diff = c.countedCents - c.expectedCents;
                  return (
                    <tr key={c.id} className={trClass}>
                      <td className={`${tdClass} whitespace-nowrap tabular-nums`}>{time(c.at)}</td>
                      <td className={tdClass}>
                        {COUNT_LABELS[c.kind]}
                        {c.note ? <span className="block text-13 text-ink-muted">{c.note}</span> : null}
                      </td>
                      <td className={tdClass}>{c.by ?? "Maestra"}</td>
                      <td className={`${tdClass} ${numClass}`}>{formatPrice(c.expectedCents)}</td>
                      <td className={`${tdClass} ${numClass}`}>{formatPrice(c.countedCents)}</td>
                      <td className={tdClass}>
                        <Badge tone={diff === 0 ? "success" : "danger"}>{differenceText(diff, formatPrice)}</Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableCard>
        )}
        {d.depositCents !== null && <p className="mt-3 text-13 text-ink-muted">Deposited {formatPrice(d.depositCents)}; the rest stays in the drawer for tomorrow.</p>}
      </Section>
      {d.counts
        .filter((c) => c.countedCents !== c.expectedCents && c.kind !== "open")
        .map((c) => {
          const moves = movesBefore(c, d.counts, d.moves);
          return (
            <Section key={c.id} title={`Cash before the ${time(c.at)} count`} titleId={`moves-${c.id}`} description="Every cash payment and refund since the count before it, with who took it.">
              {moves.length === 0 ? (
                <p className="text-sm text-ink-muted">No cash came in or went out since the count before it.</p>
              ) : (
                <TableCard>
                  <table className={tableClass}>
                    <thead className={theadClass}>
                      <tr>
                        <th className={thClass}>Time</th>
                        <th className={thClass}>Sale</th>
                        <th className={thClass}>Taken by</th>
                        <th className={`${thClass} ${numClass}`}>Cash</th>
                      </tr>
                    </thead>
                    <tbody>
                      {moves.map((m, i) => (
                        <tr key={i} className={trClass}>
                          <td className={`${tdClass} tabular-nums`}>{time(m.at)}</td>
                          <td className={tdClass}>
                            <Link href={`/sales/${m.saleId}`} className={nameLinkClass}>
                              #{m.saleNumber}
                            </Link>
                          </td>
                          <td className={tdClass}>{m.by ?? "Maestra"}</td>
                          <td className={`${tdClass} ${numClass}`}>{m.amountCents < 0 ? `−${formatPrice(-m.amountCents)}` : formatPrice(m.amountCents)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableCard>
              )}
            </Section>
          );
        })}
    </AppShell>
  );
}
