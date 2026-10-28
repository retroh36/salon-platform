import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AppShell, LoadingShell, NotLinked } from "@/components/app-shell";
import { PageHeader } from "@/components/ui/page";
import { canManage, getCurrentStaff } from "@/lib/auth";
import { isLocalDate, startOfWeek, todayIn } from "@/lib/scheduling/time";
import { isFrontOfHouse } from "@/lib/staff";
import { loadWeekGrid } from "@/lib/team-schedule-load";
import { SchedulingTabs } from "./scheduling-tabs";
import { WeekGridView } from "./week-grid";

export const metadata: Metadata = { title: "Scheduling" };

export default function SchedulingPage({ searchParams }: PageProps<"/scheduling">) {
  return (
    <Suspense fallback={<LoadingShell />}>
      <Scheduling searchParams={searchParams} />
    </Suspense>
  );
}

// The team's week. Owners and managers edit it as a draft and publish it;
// the front desk sees what's published; stylists and assistants have their
// own schedule (Team → Schedule, and My day).
async function Scheduling({ searchParams }: Pick<PageProps<"/scheduling">, "searchParams">) {
  const [params, { supabase, staff: me }] = await Promise.all([searchParams, getCurrentStaff()]);
  if (!me) return <NotLinked />;
  if (!isFrontOfHouse(me.role)) redirect("/schedule");
  const editable = canManage(me.role);
  const today = todayIn(me.location.timezone);
  const week = typeof params.week === "string" && isLocalDate(params.week) ? startOfWeek(params.week) : startOfWeek(today);
  const grid = await loadWeekGrid(supabase, me.location, week, { drafts: editable });

  return (
    <AppShell section={editable ? "scheduling" : "team"} me={me} wide>
      <PageHeader title="Scheduling" description={editable ? "Plan the team's week, then publish it." : "The team's published schedule."} />
      <SchedulingTabs current="team" />
      <WeekGridView grid={grid} today={today} editable={editable} />
    </AppShell>
  );
}
