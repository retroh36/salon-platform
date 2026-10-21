import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AppShell, LoadingShell, NotLinked } from "@/components/app-shell";
import { canManage, getCurrentStaff } from "@/lib/auth";
import { formatIntervals } from "@/lib/schedule-format";
import { WEEKDAY_NAMES } from "@/lib/schedule-forms";
import { loadLocationSchedule } from "@/lib/scheduling/load";
import { minuteToTime, WEEKDAYS } from "@/lib/scheduling/time";
import { saveOpeningHours } from "../actions";
import { HoursEditor, type HoursRows } from "../hours-editor";

export const metadata: Metadata = { title: "Opening hours · Salon Platform" };

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
    <AppShell section="schedule" businessName={me.location.business?.name} userName={me.first_name}>
      <Link href="/schedule" className="text-sm text-neutral-500 hover:text-neutral-900">
        ← Schedule
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">Opening hours</h1>
      <p className="mb-6 text-sm text-neutral-500">
        {me.location.name} · {me.location.timezone}. Staff can only be booked while the salon is open.
      </p>
      <section className="rounded-xl border border-neutral-200 bg-white">
        {canManage(me.role) ? (
          <HoursEditor action={saveOpeningHours} initial={rows} label="Opening hours" />
        ) : (
          <dl className="divide-y divide-neutral-100">
            {WEEKDAYS.map((d) => (
              <div key={d} className="flex gap-4 px-5 py-2 text-sm">
                <dt className="w-28 font-medium">{WEEKDAY_NAMES[d]}</dt>
                <dd className={weekly[d]?.length ? "" : "text-neutral-400"}>{weekly[d]?.length ? formatIntervals(weekly[d]) : "Closed"}</dd>
              </div>
            ))}
          </dl>
        )}
      </section>
    </AppShell>
  );
}
