import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AppShell, LoadingShell, NotLinked } from "@/components/app-shell";
import { LiveRefresh } from "@/components/live-calendar";
import { PageHeader } from "@/components/ui/page";
import { canManage, getCurrentStaff } from "@/lib/auth";
import { isLocalDate, startOfWeek, todayIn } from "@/lib/scheduling/time";
import { coverageFlags, DRAFT_FEATURE, nextMonth } from "@/lib/coverage";
import { coverageForGrid } from "@/lib/coverage-load";
import { isFrontOfHouse } from "@/lib/staff";
import { countPendingRequests } from "@/lib/time-off-requests-load";
import { loadWeekGrid } from "@/lib/team-schedule-load";
import { DeniseSchedule, type MonthDraft } from "./denise-schedule";
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
  const [grid, pending, draft] = await Promise.all([
    loadWeekGrid(supabase, me.location, week, { drafts: editable }),
    editable ? countPendingRequests(supabase, me.location, today) : null,
    editable ? loadMonthDraft(supabase, me.location.id) : null,
  ]);
  // Denise's checks on the week shown (from today on), for those who plan it.
  const coverage = editable ? await coverageForGrid(supabase, grid) : null;
  const flags = coverage ? coverage.days.filter((d) => d.date >= today).flatMap((d) => coverageFlags(coverage.people, d)) : [];

  return (
    <AppShell section={editable ? "scheduling" : "team"} me={me} wide>
      <PageHeader title="Scheduling" description={editable ? "Plan the team's week, then publish it." : "The team's published schedule."} />
      <SchedulingTabs current="team" pending={pending} />
      {editable && <DeniseSchedule flags={flags} draft={draft} monthName={nextMonth(today).name} />}
      {/* The front desk's published week follows a publish without a reload. */}
      {!editable && <LiveRefresh locationId={me.location.id} />}
      <WeekGridView grid={grid} today={today} editable={editable} />
    </AppShell>
  );
}

// Denise's latest month draft: waiting, or applied in the last day (for Undo).
async function loadMonthDraft(supabase: Awaited<ReturnType<typeof getCurrentStaff>>["supabase"], locationId: string): Promise<MonthDraft | null> {
  const { data, error } = await supabase
    .from("ai_actions")
    .select("id, status, summary, reason, proposal, decided_at")
    .eq("location_id", locationId)
    .eq("feature", DRAFT_FEATURE)
    .in("status", ["proposed", "approved"])
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) throw error;
  const row = data[0];
  if (!row || (row.status === "approved" && Date.parse(row.decided_at ?? "") < Date.now() - 86_400_000)) return null;
  const proposal = row.proposal as { filled?: string[]; left?: string[] };
  return { id: row.id, status: row.status as MonthDraft["status"], summary: row.summary, reason: row.reason, filled: proposal.filled ?? [], left: proposal.left ?? [] };
}
