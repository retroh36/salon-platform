import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AppShell, LoadingShell, NotLinked } from "@/components/app-shell";
import { PageHeader } from "@/components/ui/page";
import { canManage, getCurrentStaff } from "@/lib/auth";
import { todayIn } from "@/lib/scheduling/time";
import { loadRequestsInbox } from "@/lib/time-off-requests-load";
import { SchedulingTabs } from "../scheduling-tabs";
import { RequestsView } from "./requests-view";

export const metadata: Metadata = { title: "Time-off requests" };

export default function RequestsPage() {
  return (
    <Suspense fallback={<LoadingShell />}>
      <Requests />
    </Suspense>
  );
}

// Time off the team has asked for: each with the clients booked then and
// who else is off, to approve, decline with a reason, or approve and plan
// the clients.
async function Requests() {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me) return <NotLinked />;
  if (!canManage(me.role)) redirect("/time-off");
  const today = todayIn(me.location.timezone);
  const inbox = await loadRequestsInbox(supabase, me.location, today);
  return (
    <AppShell section="scheduling" me={me} wide>
      <PageHeader title="Scheduling" description="Time off the team has asked for." />
      <SchedulingTabs current="requests" pending={inbox.pending.length} />
      <RequestsView inbox={inbox} today={today} timezone={me.location.timezone} />
    </AppShell>
  );
}
