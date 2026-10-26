import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AppShell, LoadingShell, NotLinked } from "@/components/app-shell";
import { buttonClass } from "@/components/ui/button";
import { PlusIcon } from "@/components/ui/icons";
import { Alert, Badge, EmptyState, PageHeader, nameLinkClass } from "@/components/ui/page";
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
          <Link href="/events/new" className={buttonClass("primary")}>
            <PlusIcon className="size-4" />
            New event
          </Link>
        }
      />
      {failedFor.size > 0 && (
        <Alert className="mb-6">
          <ul className="flex flex-col gap-1">
            {events
              .filter((e) => failedFor.has(e.id))
              .map((e) => (
                <li key={e.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <span>
                    A payment didn&rsquo;t go through for the{" "}
                    <Link href={`/events/${e.id}`} className="font-semibold underline-offset-2 hover:underline">
                      {e.title}
                    </Link>
                    .
                  </span>
                  <Link href={`/events/${e.id}`} className="font-medium whitespace-nowrap underline-offset-2 hover:underline">
                    Open event &rarr;
                  </Link>
                </li>
              ))}
          </ul>
        </Alert>
      )}
      {events.length === 0 ? (
        <EmptyState action={<Link href="/events/new" className={buttonClass("secondary")}>New event</Link>}>No events yet. Start one and describe it to Denise.</EmptyState>
      ) : (
        <>
          <div className="-mx-4 overflow-x-auto overscroll-x-contain px-4 pb-2">
            <ol className="grid min-w-[66rem] grid-cols-6 gap-4" aria-label="Pipeline">
              {PIPELINE.map((col) => {
                const list = events.filter((e) => column(e) === col.key);
                return (
                  <li key={col.key} className="flex min-w-0 flex-col gap-3" aria-labelledby={`col-${col.key}`} data-testid={`column-${col.key}`}>
                    <h2 id={`col-${col.key}`} className="border-b border-line pb-2 text-13 font-medium text-ink">
                      {col.label} <span className="ml-1 font-normal text-ink-subtle tabular-nums">{list.length}</span>
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
            <p className="mt-8 border-t border-line pt-4 text-13 text-ink-muted" data-testid="column-lost">
              <span className="font-medium text-ink">Lost ({lost.length})</span>
              {lost.map((e) => (
                <span key={e.id}>
                  {" · "}
                  <Link href={`/events/${e.id}`} className={nameLinkClass}>
                    {e.title}
                  </Link>
                  , {formatEventDay(e.date)}
                  {e.lostReason && ` · ${e.lostReason}`}
                </span>
              ))}
            </p>
          )}
        </>
      )}
    </AppShell>
  );
}

function EventCard({ e, failedCents }: { e: EventSummary; failedCents?: number }) {
  return (
    <Link
      href={`/events/${e.id}`}
      className="flex flex-col gap-1 rounded-lg border border-line bg-surface p-3 transition-colors duration-(--motion-fast) hover:border-line-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
    >
      <span className="text-sm font-semibold text-ink">{e.title}</span>
      <span className="text-13 text-ink-muted">
        {formatEventDay(e.date)}
        {e.readyBy != null && ` · ${formatMinute(e.readyBy)}`}
      </span>
      <span className="flex items-baseline justify-between gap-2 text-13 text-ink-muted">
        <span className="min-w-0">
          <span className="whitespace-nowrap">
            {e.partySize} {e.partySize === 1 ? "person" : "people"}
          </span>
          {e.onLocation && <> <span className="whitespace-nowrap">· On location</span></>}
          {e.source === "online" && <> <span className="whitespace-nowrap">· Online</span></>}
        </span>
        <span className="text-ink tabular-nums">{e.totalCents ? formatPrice(e.totalCents) : ""}</span>
      </span>
      {failedCents != null && (
        <span className="mt-1">
          <Badge tone="danger" className="h-auto! min-h-5 py-0.5 whitespace-normal!">Payment failed · {formatPrice(failedCents)}</Badge>
        </span>
      )}
    </Link>
  );
}
