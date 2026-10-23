import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AppShell, LoadingShell, NotLinked } from "@/components/app-shell";
import { ChevronLeftIcon } from "@/components/ui/icons";
import { listClass, PageHeader } from "@/components/ui/page";
import { canManage, getCurrentStaff } from "@/lib/auth";
import { formatIntervals } from "@/lib/schedule-format";
import { WEEKDAY_NAMES } from "@/lib/schedule-forms";
import { loadLocationSchedule } from "@/lib/scheduling/load";
import { minuteToTime, WEEKDAYS } from "@/lib/scheduling/time";
import { saveOpeningHours } from "../actions";
import { HoursEditor, type HoursRows } from "../hours-editor";

export const metadata: Metadata = { title: "Opening hours" };

export default function OpeningHoursPage() {
  return (
    <Suspense fallback={<LoadingShell />}>
      <OpeningHours />
    </Suspense>
  );
}

async function OpeningHours() {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me) return <NotLinked />;

  const { weekly } = await loadLocationSchedule(supabase, me.location);
  const rows: HoursRows = Object.fromEntries(
    WEEKDAYS.map((d) => [d, (weekly[d] ?? []).map((i) => ({ start: minuteToTime(i.start), end: minuteToTime(i.end) }))]),
  );

  return (
    <AppShell section="team" me={me}>
      <Link href="/schedule" className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-ink-muted transition-colors duration-(--motion-fast) hover:text-navy-900">
        <ChevronLeftIcon className="size-4" />
        Schedule
      </Link>
      <PageHeader
        title="Opening hours"
        description={
          <>
            {me.location.name} · {me.location.timezone}. Staff can only be booked while the salon is open.
          </>
        }
      />
      <section className="overflow-hidden rounded-xl border border-line bg-surface shadow-card">
        {canManage(me.role) ? (
          <HoursEditor action={saveOpeningHours} initial={rows} label="Opening hours" />
        ) : (
          <dl className={listClass}>
            {WEEKDAYS.map((d) => (
              <div key={d} className="flex gap-4 px-5 py-2.5 text-sm">
                <dt className="w-28 font-semibold">{WEEKDAY_NAMES[d]}</dt>
                <dd className={weekly[d]?.length ? "" : "text-ink-muted"}>{weekly[d]?.length ? formatIntervals(weekly[d]) : "Closed"}</dd>
              </div>
            ))}
          </dl>
        )}
      </section>
    </AppShell>
  );
}
