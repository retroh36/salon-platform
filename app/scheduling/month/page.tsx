import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AppShell, LoadingShell, NotLinked } from "@/components/app-shell";
import { LiveRefresh } from "@/components/live-calendar";
import { PageHeader } from "@/components/ui/page";
import { canManage, getCurrentStaff } from "@/lib/auth";
import { parseMonth } from "@/lib/calendar-month";
import { nextMonth } from "@/lib/coverage";
import { loadMonthGrid } from "@/lib/schedule-month-load";
import { todayIn } from "@/lib/scheduling/time";
import { isFrontOfHouse } from "@/lib/staff";
import { countPendingRequests } from "@/lib/time-off-requests-load";
import { can } from "@/lib/permissions";
import { clockOn, loadEntries } from "@/lib/time-clock-load";
import { DeniseSchedule } from "../denise-schedule";
import { loadMonthDraft } from "../month-draft";
import { SchedulingTabs } from "../scheduling-tabs";
import { MonthGridView } from "../month-grid";

export const metadata: Metadata = { title: "Scheduling · Month" };

export default function SchedulingMonthPage({ searchParams }: PageProps<"/scheduling/month">) {
  return (
    <Suspense fallback={<LoadingShell />}>
      <SchedulingMonth searchParams={searchParams} />
    </Suspense>
  );
}

// The team schedule a month at a time (?month=2026-11), or one person's
// month (&staff=). Owners and managers plan it as a draft, with Denise's
// checks for every day; the front desk sees what's published.
async function SchedulingMonth({ searchParams }: Pick<PageProps<"/scheduling/month">, "searchParams">) {
  const [params, { supabase, staff: me }] = await Promise.all([searchParams, getCurrentStaff()]);
  if (!me) return <NotLinked />;
  if (!isFrontOfHouse(me.role)) redirect("/schedule");
  const editable = canManage(me.role);
  const today = todayIn(me.location.timezone);
  const month = parseMonth(typeof params.month === "string" ? params.month : undefined, today);
  const [grid, pending, draft] = await Promise.all([
    loadMonthGrid(supabase, me.location, month, { drafts: editable, levels: me.levels }),
    editable ? countPendingRequests(supabase, me.location, today) : null,
    editable ? loadMonthDraft(supabase, me.location.id) : null,
  ]);
  // Clocked hours, for those who manage the team or run payroll.
  const clockRole = can(me, "team") || can(me, "payroll");
  const clock = clockRole && (await clockOn(supabase, me.business_id)) ? await loadEntries(supabase, me.location, grid.weeks[0][0], grid.weeks.at(-1)![6]) : null;
  const person = typeof params.staff === "string" ? (grid.people.find((p) => p.id === params.staff) ?? null) : null;
  // Denise's checks from today on, for the month (or this person's days).
  const flags = Object.entries(grid.flags)
    .filter(([date]) => date >= today && date.startsWith(month))
    .flatMap(([, f]) => f)
    .filter((f) => !person || f.staffIds.length === 0 || f.staffIds.includes(person.id));

  return (
    <AppShell section={editable ? "scheduling" : "team"} me={me} wide denise="overlay">
      <PageHeader title="Scheduling" description={editable ? "Plan the team's month, then publish it." : "The team's published schedule."} />
      <SchedulingTabs current="team" pending={pending} />
      {editable && <DeniseSchedule flags={flags} draft={draft} monthName={nextMonth(today).name} period="month" />}
      {!editable && <LiveRefresh locationId={me.location.id} />}
      <MonthGridView
        grid={grid}
        today={today}
        editable={editable}
        person={person}
        clock={clock && { entries: clock.map((e) => ({ ...e, clockIn: e.clockIn.toISOString(), clockOut: e.clockOut?.toISOString() ?? null })), canEdit: can(me, "team"), timeZone: me.location.timezone, now: new Date().toISOString() }}
      />
    </AppShell>
  );
}
