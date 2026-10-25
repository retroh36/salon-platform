import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AppShell, LoadingShell, NotLinked } from "@/components/app-shell";
import { buttonClass } from "@/components/ui/button";
import { Card, EmptyState, PageHeader } from "@/components/ui/page";
import { getCurrentStaff } from "@/lib/auth";
import { loadEventList } from "@/lib/events/load";
import { EVENT_STATUS_LABELS, type EventStatus } from "@/lib/events/types";
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

const ORDER: EventStatus[] = ["inquiry", "proposal_sent", "booked", "trial_done", "completed", "lost"];

async function Events() {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me) return <NotLinked />;
  if (!isFrontOfHouse(me.role)) redirect("/dashboard");
  const tz = me.location.timezone;
  const events = await loadEventList(supabase, me.business_id, tz, addDays(todayIn(tz), -60));
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
      {events.length === 0 ? (
        <EmptyState>No events yet. Tap New event and describe it to Denise.</EmptyState>
      ) : (
        <div className="flex flex-col gap-6">
          {ORDER.map((status) => {
            const list = events.filter((e) => e.status === status);
            if (!list.length) return null;
            return (
              <Card key={status} title={`${EVENT_STATUS_LABELS[status]} (${list.length})`} titleId={`status-${status}`} flush>
                <ul className="divide-y divide-line">
                  {list.map((e) => (
                    <li key={e.id}>
                      <Link href={`/events/${e.id}`} className="flex items-baseline justify-between gap-3 px-5 py-3 hover:bg-sunken">
                        <span className="min-w-0">
                          <span className="font-semibold">{e.title}</span>
                          <span className="block text-sm text-ink-muted">
                            {formatEventDay(e.date)}
                            {e.readyBy != null && ` · ready by ${formatMinute(e.readyBy)}`} · {e.partySize} {e.partySize === 1 ? "person" : "people"}
                            {e.onLocation && ` · ${e.venueName ?? "on location"}`}
                          </span>
                        </span>
                        <span className="tabular-nums">{e.totalCents ? formatPrice(e.totalCents) : ""}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </Card>
            );
          })}
        </div>
      )}
    </AppShell>
  );
}
