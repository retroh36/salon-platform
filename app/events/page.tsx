import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AppShell, LoadingShell, NotLinked } from "@/components/app-shell";
import { buttonClass } from "@/components/ui/button";
import { Alert, Card, EmptyState, PageHeader } from "@/components/ui/page";
import { getCurrentStaff } from "@/lib/auth";
import { loadEventList, type EventSummary } from "@/lib/events/load";
import { PIPELINE, pipelineColumn } from "@/lib/events/pipeline";
import { addDays, formatMinute, todayIn } from "@/lib/scheduling/time";
import { formatPrice } from "@/lib/services";
import { isFrontOfHouse } from "@/lib/staff";
import { formatEventDay } from "./format";

export const metadata: Metadata = { title: "Events" };

export default function EventsPage() {
  return (
    <Suspense fallback={<LoadingShell />}>
      <Events />
    </Suspense>
  );
}

async function Events() {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me) return <NotLinked />;
  if (!isFrontOfHouse(me.role)) redirect("/dashboard");
  const tz = me.location.timezone;
  const today = todayIn(tz);
  const [events, failed] = await Promise.all([
    loadEventList(supabase, me.business_id, tz, addDays(today, -60)),
    supabase.from("event_payments").select("event_id, amount_cents").eq("business_id", me.business_id).eq("status", "failed"),
  ]);
  const failedFor = new Map((failed.data ?? []).map((p) => [p.event_id, p.amount_cents]));
  const column = (e: EventSummary) => pipelineColumn(e.status, e.date, today);
  const lost = events.filter((e) => e.status === "lost");
  return (
    <AppShell section="events" me={me} wide>
      <PageHeader
        title="Events"
        description="Weddings and other events, from inquiry to the day."
        actions={
          <Link href="/events/new" className={buttonClass("primary", "md")}>
            New event
          </Link>
        }
      />
      {failedFor.size > 0 && (
        <Alert className="mb-4">
          {failedFor.size === 1 ? "A payment didn't go through" : `${failedFor.size} payments didn't go through`}:{" "}
          {events
            .filter((e) => failedFor.has(e.id))
            .map((e, i) => (
              <span key={e.id}>
                {i > 0 && ", "}
                <Link href={`/events/${e.id}`} className="font-semibold underline underline-offset-2">
                  {e.title}
                </Link>
              </span>
            ))}
          . Try the card again or ask for another from the event.
        </Alert>
      )}
      {events.length === 0 ? (
        <EmptyState>No events yet. Tap New event and describe it to Denise.</EmptyState>
      ) : (
        <>
          <div className="-mx-4 overflow-x-auto overscroll-x-contain px-4 pb-2">
            <ol className="grid min-w-[66rem] grid-cols-6 gap-3" aria-label="Pipeline">
              {PIPELINE.map((col) => {
                const list = events.filter((e) => column(e) === col.key);
                return (
                  <li key={col.key} className="flex min-w-0 flex-col gap-2 rounded-xl bg-sunken p-2" aria-labelledby={`col-${col.key}`} data-testid={`column-${col.key}`}>
                    <h2 id={`col-${col.key}`} className="px-1 pt-1 text-sm font-semibold text-ink-muted">
                      {col.label} <span className="font-normal">({list.length})</span>
                    </h2>
                    <ul className="flex flex-col gap-2">
                      {list.map((e) => (
                        <li key={e.id}>
                          <EventCard e={e} failedCents={failedFor.get(e.id)} />
                        </li>
                      ))}
                    </ul>
                  </li>
                );
              })}
            </ol>
          </div>
          {lost.length > 0 && (
            <Card title={`Lost (${lost.length})`} titleId="lost" flush className="mt-6">
              <ul className="divide-y divide-line" data-testid="column-lost">
                {lost.map((e) => (
                  <li key={e.id}>
                    <Link href={`/events/${e.id}`} className="flex items-baseline justify-between gap-3 px-5 py-3 hover:bg-sunken">
                      <span className="min-w-0">
                        <span className="font-semibold">{e.title}</span>
                        <span className="block text-sm text-ink-muted">
                          {formatEventDay(e.date)}
                          {e.lostReason && ` · ${e.lostReason}`}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}
    </AppShell>
  );
}

function EventCard({ e, failedCents }: { e: EventSummary; failedCents?: number }) {
  return (
    <Link href={`/events/${e.id}`} className="flex flex-col gap-0.5 rounded-lg border border-line bg-surface px-3 py-2.5 shadow-card hover:border-line-strong">
      <span className="font-semibold">{e.title}</span>
      <span className="text-sm text-ink-muted">
        {formatEventDay(e.date)}
        {e.readyBy != null && ` · ${formatMinute(e.readyBy)}`}
      </span>
      <span className="flex justify-between gap-2 text-sm text-ink-muted">
        <span>
          {e.partySize} {e.partySize === 1 ? "person" : "people"}
          {e.onLocation && " · on location"}
          {e.source === "online" && " · online"}
        </span>
        <span className="tabular-nums text-ink">{e.totalCents ? formatPrice(e.totalCents) : ""}</span>
      </span>
      {failedCents != null && <span className="text-sm font-medium text-danger">{formatPrice(failedCents)} didn&rsquo;t go through</span>}
    </Link>
  );
}
