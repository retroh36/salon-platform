import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AppShell, LoadingShell, NotLinked } from "@/components/app-shell";
import { PageHeader } from "@/components/ui/page";
import { canManage, getCurrentStaff } from "@/lib/auth";
import { todayIn } from "@/lib/scheduling/time";
import { canSwap } from "@/lib/shift-swaps";
import { loadMySwaps } from "@/lib/shift-swaps-load";
import { SwapsView } from "./swaps-view";

export const metadata: Metadata = { title: "Shift swaps" };

export default function ShiftSwapsPage() {
  return (
    <Suspense fallback={<LoadingShell />}>
      <ShiftSwaps />
    </Suspense>
  );
}

// The front desk and assistants swap days with someone in the same role:
// ask, the coworker accepts, then a manager approves.
async function ShiftSwaps() {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me) return <NotLinked />;
  if (canManage(me.role)) redirect("/scheduling/requests");
  if (!canSwap(me.role)) redirect("/time-off");
  const today = todayIn(me.location.timezone);
  const swaps = await loadMySwaps(supabase, me, today);
  return (
    <AppShell section={me.role === "assistant" ? "my-day" : "team"} me={me}>
      <PageHeader title="Shift swaps" description="Give a day to a coworker, or trade one. They accept, then a manager approves it." />
      <SwapsView {...swaps} today={today} />
    </AppShell>
  );
}
