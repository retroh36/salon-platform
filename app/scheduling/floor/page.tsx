import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AppShell, LoadingShell, NotLinked } from "@/components/app-shell";
import { PageHeader } from "@/components/ui/page";
import { canManage, getCurrentStaff } from "@/lib/auth";
import { loadFloor } from "@/lib/floor-load";
import { isLocalDate, todayIn } from "@/lib/scheduling/time";
import { isFrontOfHouse } from "@/lib/staff";
import { countPendingRequests } from "@/lib/time-off-requests-load";
import { SchedulingTabs } from "../scheduling-tabs";
import { FloorView } from "./floor-view";

export const metadata: Metadata = { title: "Floor today" };

export default function FloorPage({ searchParams }: PageProps<"/scheduling/floor">) {
  return (
    <Suspense fallback={<LoadingShell />}>
      <FloorDay searchParams={searchParams} />
    </Suspense>
  );
}

// Each station and who's using it when: its own stylist while they work,
// anyone it's lent to, and clients booked into rooms.
async function FloorDay({ searchParams }: Pick<PageProps<"/scheduling/floor">, "searchParams">) {
  const [params, { supabase, staff: me }] = await Promise.all([searchParams, getCurrentStaff()]);
  if (!me) return <NotLinked />;
  if (!isFrontOfHouse(me.role)) redirect("/schedule");
  const today = todayIn(me.location.timezone);
  const date = typeof params.date === "string" && isLocalDate(params.date) ? params.date : today;
  const editable = canManage(me.role);
  const [floor, pending] = await Promise.all([loadFloor(supabase, me.location, date), editable ? countPendingRequests(supabase, me.location, today) : null]);
  return (
    <AppShell section={editable ? "scheduling" : "team"} me={me} wide>
      <PageHeader title="Scheduling" description="Who's at each chair and station, and when." />
      <SchedulingTabs current="floor" pending={pending} />
      <FloorView floor={floor} today={today} editable={editable && date >= today} />
    </AppShell>
  );
}
